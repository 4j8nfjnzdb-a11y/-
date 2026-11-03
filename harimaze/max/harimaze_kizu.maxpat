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
          "text": "KIZU 傷盤 — wounded disc",
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
          "text": "傷ついた CD を鳴らすプレーヤー。引っかかって同じ断片を繰り返し（stick、少しずつずれる creep）、\n飛び（skip）、無音に落ち（drop）、数 ms のフレームがジーッと鳴る（zip）。\n故障中はエラー補間が崩れたように音が粗くなる（crush）。",
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
          "text": "文脈: Oval（マーカーで塗った CD）/ 刀根康尚『Solo for Wounded CD』（穴を開けたテープ）/ Pontiac Streator の Oval 的グリッチ",
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
          "text": "1  音源 SOURCE（CD 役）",
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
            156,
            22.0
          ],
          "outlettype": [
            ""
          ],
          "text": "replace cherokee.aif",
          "id": "obj-6"
        }
      },
      {
        "box": {
          "maxclass": "message",
          "numinlets": 2,
          "numoutlets": 1,
          "patching_rect": [
            184,
            174,
            142,
            22.0
          ],
          "outlettype": [
            ""
          ],
          "text": "replace jongly.aif",
          "id": "obj-7"
        }
      },
      {
        "box": {
          "maxclass": "message",
          "numinlets": 2,
          "numoutlets": 1,
          "patching_rect": [
            330,
            174,
            135,
            22.0
          ],
          "outlettype": [
            ""
          ],
          "text": "replace anton.aif",
          "id": "obj-8"
        }
      },
      {
        "box": {
          "maxclass": "message",
          "numinlets": 2,
          "numoutlets": 1,
          "patching_rect": [
            469,
            174,
            65,
            22.0
          ],
          "outlettype": [
            ""
          ],
          "text": "replace",
          "id": "obj-9"
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            527,
            176,
            120,
            21.95
          ],
          "text": "← ファイルを選ぶ",
          "fontsize": 11.0,
          "id": "obj-10"
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
          "id": "obj-11"
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
          "id": "obj-12"
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
          "id": "obj-13"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "buffer~ hz_kizu_src 30000 2",
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
          "id": "obj-14"
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
          "id": "obj-15"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "loadmess replace cherokee.aif",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            354,
            300,
            217,
            22.0
          ],
          "hidden": 1,
          "id": "obj-16"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "loadmess set hz_kizu_src",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            210,
            300,
            182,
            22.0
          ],
          "hidden": 1,
          "id": "obj-17"
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
          "id": "obj-18"
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
          "id": "obj-19"
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
          "text": "speed\n速度  -2〜2",
          "fontsize": 11.0,
          "linecount": 2,
          "id": "obj-20"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "r kizu_speed",
          "numinlets": 0,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            94,
            412,
            98,
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
            24,
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
          "id": "obj-22"
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
            24,
            438,
            105,
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
            150,
            372,
            122,
            37.9
          ],
          "text": "damage\n損傷  0〜1",
          "fontsize": 11.0,
          "linecount": 2,
          "id": "obj-24"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "r kizu_damage",
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
          "id": "obj-25"
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
          "id": "obj-26"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "prepend damage",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            150,
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
            276,
            372,
            122,
            37.9
          ],
          "text": "stick\n引っかかり  0〜1",
          "fontsize": 11.0,
          "linecount": 2,
          "id": "obj-28"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "r kizu_stick",
          "numinlets": 0,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            346,
            412,
            98,
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
          "id": "obj-30"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "prepend stick",
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
          "id": "obj-31"
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
          "text": "skip\n飛び  0〜1",
          "fontsize": 11.0,
          "linecount": 2,
          "id": "obj-32"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "r kizu_skip",
          "numinlets": 0,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            472,
            412,
            91,
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
          "id": "obj-34"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "prepend skip",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            402,
            438,
            98,
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
            528,
            372,
            122,
            37.9
          ],
          "text": "drop\n欠落  0〜1",
          "fontsize": 11.0,
          "linecount": 2,
          "id": "obj-36"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "r kizu_drop",
          "numinlets": 0,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            598,
            412,
            91,
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
            528,
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
          "text": "prepend drop",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            528,
            438,
            98,
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
            654,
            372,
            122,
            37.9
          ],
          "text": "zip\nジッ音  0〜1",
          "fontsize": 11.0,
          "linecount": 2,
          "id": "obj-40"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "r kizu_zip",
          "numinlets": 0,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            724,
            412,
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
          "id": "obj-42"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "prepend zip",
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
          "id": "obj-43"
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
          "text": "sticklen\n断片 ms  10〜1000",
          "fontsize": 11.0,
          "linecount": 2,
          "id": "obj-44"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "r kizu_sticklen",
          "numinlets": 0,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            94,
            496,
            119,
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
            24,
            492,
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
          "id": "obj-46"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "prepend sticklen",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            24,
            522,
            126,
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
            150,
            456,
            122,
            37.9
          ],
          "text": "creep\nずれ  0〜1",
          "fontsize": 11.0,
          "linecount": 2,
          "id": "obj-48"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "r kizu_creep",
          "numinlets": 0,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            220,
            496,
            98,
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
          "id": "obj-50"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "prepend creep",
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
          "id": "obj-51"
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
          "text": "crush\n劣化  0〜1",
          "fontsize": 11.0,
          "linecount": 2,
          "id": "obj-52"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "r kizu_crush",
          "numinlets": 0,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            346,
            496,
            98,
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
            276,
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
          "text": "prepend crush",
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
          "id": "obj-55"
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
          "text": "click\nクリック  0〜1",
          "fontsize": 11.0,
          "linecount": 2,
          "id": "obj-56"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "r kizu_click",
          "numinlets": 0,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            472,
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
          "id": "obj-58"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "prepend click",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            402,
            522,
            105,
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
            528,
            456,
            122,
            37.9
          ],
          "text": "level\n音量  0〜1",
          "fontsize": 11.0,
          "linecount": 2,
          "id": "obj-60"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "r kizu_level",
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
          "id": "obj-61"
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
          "id": "obj-62"
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
            528,
            522,
            105,
            22.0
          ],
          "hidden": 1,
          "id": "obj-63"
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
                  "code": "// harimaze / KIZU - wounded disc\r\n// A CD player that fails: sticking loops that creep, skips, dropouts,\r\n// zipper buzz from tiny frames, and crushed error concealment.\r\n// in1  : trigger (rising edge forces an error now)\r\n// out1 : left    out2 : right\r\n// out3 : read position 0..1\r\n// out4 : 0 play, 1 stick, 2 dropout, 3 zip, 4 skip\r\n\r\nBuffer src(\"hz_kizu_src\");\r\n\r\nParam speed(1);\r\nParam damage(0.35);\r\nParam stick(0.6);\r\nParam skip(0.4);\r\nParam drop(0.25);\r\nParam zip(0.2);\r\nParam sticklen(120);\r\nParam creep(0.3);\r\nParam crush(0.4);\r\nParam click(0.5);\r\nParam level(0.8);\r\n\r\nHistory pos(0);\r\nHistory mode(0);\r\nHistory mtimer(0);\r\nHistory lstart(0);\r\nHistory llen(1000);\r\nHistory lrel(0);\r\nHistory reps(0);\r\nHistory etimer(22050);\r\nHistory gpos(0);\r\nHistory gfade(0);\r\nHistory dgain(1);\r\nHistory lastrd(0);\r\nHistory holdl(0);\r\nHistory holdr(0);\r\nHistory hcnt(0);\r\nHistory flash(0);\r\nHistory trigprev(0);\r\nHistory dcx1(0);\r\nHistory dcy1(0);\r\nHistory dcx2(0);\r\nHistory dcy2(0);\r\n\r\nblen = max(dim(src), 2);\r\nch2 = 0;\r\nif (channels(src) > 1) {\r\n\tch2 = 1;\r\n}\r\n\r\np = pos;\r\nm = mode;\r\nt = mtimer;\r\ns0 = lstart;\r\nsl = llen;\r\nr0 = lrel;\r\nrp = reps;\r\ne0 = etimer - 1;\r\ng = gpos;\r\ngf = gfade;\r\ndg = dgain;\r\nfl = max(flash - 1, 0);\r\ntrig = (in1 > 0.5) * (trigprev <= 0.5);\r\njumped = 0;\r\nr = 0;\r\nblk = 0;\r\nn = 0;\r\ndirn = 1;\r\nwsum = stick + skip + drop + zip;\r\n\r\n// error engine: only a disc that is playing normally can start a new fault\r\nif (m == 0 && (e0 <= 0 || trig > 0)) {\r\n\te0 = mstosamps(mix(6000, 60, clamp(damage, 0, 1)) * (0.3 + 1.4 * (noise() * 0.5 + 0.5)));\r\n\tif (wsum > 0.001 && (damage > 0.001 || trig > 0)) {\r\n\t\tr = (noise() * 0.5 + 0.5) * wsum;\r\n\t\tif (r < stick) {\r\n\t\t\tm = 1;\r\n\t\t\tsl = max(mstosamps(sticklen * (0.5 + (noise() * 0.5 + 0.5))), 64);\r\n\t\t\ts0 = p;\r\n\t\t\tr0 = 0;\r\n\t\t\trp = 2 + floor((noise() * 0.5 + 0.5) * 14);\r\n\t\t} else if (r < stick + skip) {\r\n\t\t\tblk = mstosamps(53.3);\r\n\t\t\tn = 1 + floor((noise() * 0.5 + 0.5) * 30);\r\n\t\t\tdirn = 1;\r\n\t\t\tif (noise() < -0.4) {\r\n\t\t\t\tdirn = -1;\r\n\t\t\t}\r\n\t\t\tp = wrap(p + dirn * n * blk, 0, blen);\r\n\t\t\tjumped = 1;\r\n\t\t\tfl = mstosamps(120);\r\n\t\t} else if (r < stick + skip + drop) {\r\n\t\t\tm = 2;\r\n\t\t\tt = mstosamps(5 + 120 * (noise() * 0.5 + 0.5));\r\n\t\t} else {\r\n\t\t\tm = 3;\r\n\t\t\tsl = max(mstosamps(0.7 + 6 * (noise() * 0.5 + 0.5)), 16);\r\n\t\t\ts0 = p;\r\n\t\t\tr0 = 0;\r\n\t\t\tt = mstosamps(60 + 500 * (noise() * 0.5 + 0.5));\r\n\t\t}\r\n\t}\r\n}\r\n\r\nrd = p;\r\nif (m == 0) {\r\n\tp = wrap(p + speed, 0, blen);\r\n\trd = p;\r\n} else if (m == 1) {\r\n\t// stuck: repeat one fragment, the stuck point creeps a little each time\r\n\tr0 = r0 + speed;\r\n\tif (r0 >= sl || r0 < 0) {\r\n\t\tr0 = wrap(r0, 0, sl);\r\n\t\trp = rp - 1;\r\n\t\tjumped = 1;\r\n\t\ts0 = wrap(s0 + creep * sl * (0.15 + 0.35 * noise()), 0, blen);\r\n\t\tif (rp <= 0) {\r\n\t\t\tm = 0;\r\n\t\t\tp = wrap(s0 + sl, 0, blen);\r\n\t\t}\r\n\t}\r\n\trd = wrap(s0 + r0, 0, blen);\r\n} else if (m == 2) {\r\n\t// dropout: digital silence while the disc keeps turning\r\n\tt = t - 1;\r\n\tp = wrap(p + speed, 0, blen);\r\n\trd = p;\r\n\tif (t <= 0) {\r\n\t\tm = 0;\r\n\t\tjumped = 1;\r\n\t}\r\n} else {\r\n\t// zip: a frame a few ms long repeats into a pitched buzz\r\n\tr0 = r0 + 1;\r\n\tif (r0 >= sl) {\r\n\t\tr0 = 0;\r\n\t}\r\n\tt = t - 1;\r\n\trd = wrap(s0 + r0, 0, blen);\r\n\tif (t <= 0) {\r\n\t\tm = 0;\r\n\t\tp = wrap(s0 + sl, 0, blen);\r\n\t\tjumped = 1;\r\n\t}\r\n}\r\n\r\n// declick: click 0 = a 4 ms crossfade from where the laser was,\r\n// click 1 = raw cuts. Dropouts fade over the same time.\r\natk = max(mstosamps(mix(4, 0, clamp(click, 0, 1))), 1);\r\ng = wrap(g + speed, 0, blen);\r\ngf = max(gf - 1 / atk, 0);\r\nif (jumped > 0) {\r\n\tg = wrap(lastrd + speed, 0, blen);\r\n\tgf = max(1 - 1 / atk, 0);\r\n}\r\ntg = 1;\r\nif (m == 2) {\r\n\ttg = 0;\r\n}\r\nif (dg < tg) {\r\n\tdg = min(dg + 1 / atk, tg);\r\n} else {\r\n\tdg = max(dg - 1 / atk, tg);\r\n}\r\n\r\ni0 = floor(rd);\r\nfr = rd - i0;\r\ni1 = wrap(i0 + 1, 0, blen);\r\nsL = mix(peek(src, i0, 0), peek(src, i1, 0), fr);\r\nsR = mix(peek(src, i0, ch2), peek(src, i1, ch2), fr);\r\nj0 = floor(g);\r\ngr = g - j0;\r\nj1 = wrap(j0 + 1, 0, blen);\r\nsL = mix(sL, mix(peek(src, j0, 0), peek(src, j1, 0), gr), gf);\r\nsR = mix(sR, mix(peek(src, j0, ch2), peek(src, j1, ch2), gr), gf);\r\n\r\n// crushed error concealment while the disc is failing\r\ncr = 0;\r\nif (m != 0 || fl > 0) {\r\n\tcr = clamp(crush, 0, 1);\r\n}\r\nhn = 1 + floor(cr * 24);\r\nhc = hcnt + 1;\r\nhl = holdl;\r\nhr = holdr;\r\nif (hc >= hn) {\r\n\thc = 0;\r\n\thl = sL;\r\n\thr = sR;\r\n}\r\nq = pow(2, mix(15, 3, cr));\r\ncL = floor(hl * q + 0.5) / q;\r\ncR = floor(hr * q + 0.5) / q;\r\n\r\noL = cL * dg;\r\noR = cR * dg;\r\n\r\nyL = oL - dcx1 + 0.9995 * dcy1;\r\nyR = oR - dcx2 + 0.9995 * dcy2;\r\ndcx1 = oL;\r\ndcy1 = yL;\r\ndcx2 = oR;\r\ndcy2 = yR;\r\n\r\nst = m;\r\nif (fl > 0 && m == 0) {\r\n\tst = 4;\r\n}\r\nout1 = yL * level;\r\nout2 = yR * level;\r\nout3 = rd / blen;\r\nout4 = st;\r\n\r\npos = p;\r\nmode = m;\r\nmtimer = t;\r\nlstart = s0;\r\nllen = sl;\r\nlrel = r0;\r\nreps = rp;\r\netimer = e0;\r\ngpos = g;\r\ngfade = gf;\r\ndgain = dg;\r\nlastrd = rd;\r\nholdl = hl;\r\nholdr = hr;\r\nhcnt = hc;\r\nflash = fl;\r\ntrigprev = in1;\r\n",
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
          "id": "obj-64"
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
          "id": "obj-65"
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
          "id": "obj-66"
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
          "text": "● 今すぐ故障させる（in1 の立ち上がりでエラーを 1 回起こす）",
          "fontsize": 11.0,
          "id": "obj-67"
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
          "id": "obj-68"
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
          "id": "obj-69"
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
          "id": "obj-70"
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
          "id": "obj-71"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "r kizu_master",
          "numinlets": 0,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            96,
            632,
            105,
            22.0
          ],
          "hidden": 1,
          "id": "obj-72"
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
          "id": "obj-73"
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
          "id": "obj-74"
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
          "id": "obj-75"
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
          "id": "obj-76"
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
          "id": "obj-77"
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
          "id": "obj-78"
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
          "id": "obj-79"
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
          "id": "obj-80"
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
          "id": "obj-81"
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
          "id": "obj-82"
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
          "id": "obj-83"
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
          "id": "obj-84"
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
          "id": "obj-85"
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
          "id": "obj-86"
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
          "id": "obj-87"
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
          "id": "obj-88"
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
          "id": "obj-89"
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
          "id": "obj-90"
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
            51.675
          ],
          "text": "状態 (out4)\n0 再生 1 引っかかり\n2 欠落 3 ジッ 4 飛び",
          "fontsize": 10.5,
          "linecount": 3,
          "id": "obj-91"
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
          "id": "obj-92"
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
          "id": "obj-93"
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
          "id": "obj-94"
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
          "id": "obj-95"
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
          "text": "新品 mint",
          "fontsize": 13.0,
          "fontface": 1,
          "id": "obj-96"
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
          "text": "傷なし。素の音源",
          "fontsize": 10.5,
          "id": "obj-97"
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
          "text": "; kizu_speed 1; kizu_damage 0; kizu_stick 0.6; kizu_skip 0.4; kizu_drop 0.25; kizu_zip 0.2; kizu_sticklen 120; kizu_creep 0.3; kizu_crush 0.4; kizu_click 0.5; kizu_level 0.8",
          "id": "obj-98"
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
            246,
            330,
            24.849999999999998
          ],
          "text": "指紋 fingerprint",
          "fontsize": 13.0,
          "fontface": 1,
          "id": "obj-100"
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
          "text": "たまに引っかかる程度",
          "fontsize": 10.5,
          "id": "obj-101"
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
          "text": "; kizu_damage 0.2; kizu_stick 0.8; kizu_skip 0.2; kizu_drop 0.1; kizu_zip 0; kizu_sticklen 200; kizu_creep 0.2; kizu_crush 0.2; kizu_click 0.3",
          "id": "obj-102"
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
            310,
            330,
            24.849999999999998
          ],
          "text": "マーカー marker",
          "fontsize": 13.0,
          "fontface": 1,
          "id": "obj-104"
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
          "text": "塗られた盤。短い断片がずれながら反復",
          "fontsize": 10.5,
          "id": "obj-105"
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
          "text": "; kizu_damage 0.6; kizu_stick 1; kizu_skip 0.3; kizu_drop 0.2; kizu_zip 0.4; kizu_sticklen 60; kizu_creep 0.5; kizu_crush 0.5; kizu_click 0.7",
          "id": "obj-106"
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
            374,
            330,
            24.849999999999998
          ],
          "text": "テープの穴 pinholes",
          "fontsize": 13.0,
          "fontface": 1,
          "id": "obj-108"
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
          "text": "誤り訂正が破綻する。ほぼ制御不能",
          "fontsize": 10.5,
          "id": "obj-109"
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
          "text": "; kizu_damage 0.9; kizu_stick 0.5; kizu_skip 0.8; kizu_drop 0.5; kizu_zip 0.7; kizu_sticklen 25; kizu_creep 0.8; kizu_crush 0.8; kizu_click 1",
          "id": "obj-110"
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
            101.7
          ],
          "text": "使い方\n1. 右下の ezdac~（スピーカー）をクリックして DSP を ON\n2. プリセットの ● を押す（起動時は 1 番目が入ります）\n3. 数字をドラッグして変える。音源はドロップで差し替え\n同梱音源（jongly.aif など）は Max 付属のサンプルです。\n見つからない場合は自分のファイルをドロップしてください。",
          "fontsize": 11.0,
          "linecount": 6,
          "id": "obj-111"
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
            "obj-14",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-7",
            0
          ],
          "destination": [
            "obj-14",
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
            "obj-14",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-9",
            0
          ],
          "destination": [
            "obj-14",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-11",
            0
          ],
          "destination": [
            "obj-13",
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
            "obj-14",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-16",
            0
          ],
          "destination": [
            "obj-14",
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
            "obj-15",
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
            "obj-23",
            0
          ],
          "destination": [
            "obj-64",
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
            "obj-64",
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
            "obj-64",
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
            "obj-64",
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
            "obj-64",
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
            "obj-64",
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
            "obj-64",
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
            "obj-64",
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
            "obj-64",
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
            "obj-64",
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
            "obj-64",
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
            "obj-64",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-64",
            0
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
            "obj-64",
            1
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
            "obj-72",
            0
          ],
          "destination": [
            "obj-73",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-77",
            0
          ],
          "destination": [
            "obj-73",
            0
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
            "obj-75",
            0
          ],
          "hidden": 1
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
            "obj-76",
            0
          ],
          "destination": [
            "obj-70",
            1
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
            "obj-71",
            1
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-70",
            0
          ],
          "destination": [
            "obj-78",
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
            "obj-78",
            1
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
            "obj-79",
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
            "obj-80",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-82",
            0
          ],
          "destination": [
            "obj-84",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-83",
            0
          ],
          "destination": [
            "obj-84",
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
            "obj-84",
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
            "obj-84",
            1
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-64",
            2
          ],
          "destination": [
            "obj-86",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-64",
            3
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
            "obj-88",
            0
          ]
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
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-95",
            0
          ],
          "destination": [
            "obj-98",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-94",
            0
          ],
          "destination": [
            "obj-98",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-99",
            0
          ],
          "destination": [
            "obj-102",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-103",
            0
          ],
          "destination": [
            "obj-106",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-107",
            0
          ],
          "destination": [
            "obj-110",
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