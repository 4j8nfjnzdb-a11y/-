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
      1036.0
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
          "text": "MEBUKI 芽吹 — texture bloom",
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
          "text": "ふたつの音源 A / B から粒（grain）を取り出す。morph は「次の粒をどちらから取るか」の確率なので、\nA のテクスチャーの中に B が少しずつ芽を出し、やがて入れ替わる。bloom で morph が勝手に揺れる。\nscan は時間の流れ（負で逆行、0 で静止）。toy で音高を五音音階に丸める。",
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
          "text": "文脈: Jake Muir のグラニュラー処理 / KMRU の環境音 + 粒 / 竹村延和のおもちゃのような旋律",
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
            350
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
          "text": "1A  音源 A（地）",
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
            142,
            22.0
          ],
          "outlettype": [
            ""
          ],
          "text": "replace jongly.aif",
          "id": "obj-6"
        }
      },
      {
        "box": {
          "maxclass": "message",
          "numinlets": 2,
          "numoutlets": 1,
          "patching_rect": [
            170,
            174,
            135,
            22.0
          ],
          "outlettype": [
            ""
          ],
          "text": "replace anton.aif",
          "id": "obj-7"
        }
      },
      {
        "box": {
          "maxclass": "message",
          "numinlets": 2,
          "numoutlets": 1,
          "patching_rect": [
            309,
            174,
            156,
            22.0
          ],
          "outlettype": [
            ""
          ],
          "text": "replace drumLoop.aif",
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
          "text": "buffer~ hz_mebuki_a 30000 1",
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
          "text": "loadmess replace jongly.aif",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            354,
            300,
            203,
            22.0
          ],
          "hidden": 1,
          "id": "obj-16"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "loadmess set hz_mebuki_a",
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
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            24,
            310,
            520,
            23.4
          ],
          "text": "1B  音源 B（芽）",
          "fontsize": 12.0,
          "fontface": 1,
          "id": "obj-18"
        }
      },
      {
        "box": {
          "maxclass": "message",
          "numinlets": 2,
          "numoutlets": 1,
          "patching_rect": [
            24,
            334,
            149,
            22.0
          ],
          "outlettype": [
            ""
          ],
          "text": "replace sho0630.aif",
          "id": "obj-19"
        }
      },
      {
        "box": {
          "maxclass": "message",
          "numinlets": 2,
          "numoutlets": 1,
          "patching_rect": [
            177,
            334,
            156,
            22.0
          ],
          "outlettype": [
            ""
          ],
          "text": "replace vibes-a1.aif",
          "id": "obj-20"
        }
      },
      {
        "box": {
          "maxclass": "message",
          "numinlets": 2,
          "numoutlets": 1,
          "patching_rect": [
            337,
            334,
            156,
            22.0
          ],
          "outlettype": [
            ""
          ],
          "text": "replace cherokee.aif",
          "id": "obj-21"
        }
      },
      {
        "box": {
          "maxclass": "message",
          "numinlets": 2,
          "numoutlets": 1,
          "patching_rect": [
            497,
            334,
            65,
            22.0
          ],
          "outlettype": [
            ""
          ],
          "text": "replace",
          "id": "obj-22"
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            555,
            336,
            120,
            21.95
          ],
          "text": "← ファイルを選ぶ",
          "fontsize": 11.0,
          "id": "obj-23"
        }
      },
      {
        "box": {
          "maxclass": "dropfile",
          "numinlets": 1,
          "numoutlets": 2,
          "patching_rect": [
            24,
            364,
            170,
            58
          ],
          "outlettype": [
            "",
            ""
          ],
          "id": "obj-24"
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            32,
            426,
            170,
            36.45
          ],
          "text": "ここに音声ファイルを\nドロップ (wav / aif)",
          "fontsize": 10.5,
          "linecount": 2,
          "id": "obj-25"
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
            460,
            119,
            22.0
          ],
          "hidden": 1,
          "id": "obj-26"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "buffer~ hz_mebuki_b 30000 1",
          "numinlets": 1,
          "numoutlets": 2,
          "outlettype": [
            "float",
            "bang"
          ],
          "patching_rect": [
            210,
            426,
            230,
            22.0
          ],
          "id": "obj-27"
        }
      },
      {
        "box": {
          "maxclass": "waveform~",
          "numinlets": 5,
          "numoutlets": 6,
          "patching_rect": [
            210,
            364,
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
          "id": "obj-28"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "loadmess replace sho0630.aif",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            354,
            460,
            210,
            22.0
          ],
          "hidden": 1,
          "id": "obj-29"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "loadmess set hz_mebuki_b",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            210,
            460,
            182,
            22.0
          ],
          "hidden": 1,
          "id": "obj-30"
        }
      },
      {
        "box": {
          "maxclass": "panel",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            12,
            496,
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
          "id": "obj-31"
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            24,
            504,
            700,
            23.4
          ],
          "text": "2  パラメータ PARAMETERS — 数字をドラッグ / ダブルクリックで入力",
          "fontsize": 12.0,
          "fontface": 1,
          "id": "obj-32"
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            24,
            532,
            122,
            37.9
          ],
          "text": "morph\n移ろい A→B  0〜1",
          "fontsize": 11.0,
          "linecount": 2,
          "id": "obj-33"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "r mebuki_morph",
          "numinlets": 0,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            94,
            572,
            112,
            22.0
          ],
          "hidden": 1,
          "id": "obj-34"
        }
      },
      {
        "box": {
          "maxclass": "flonum",
          "numinlets": 1,
          "numoutlets": 2,
          "patching_rect": [
            24,
            568,
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
          "id": "obj-35"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "prepend morph",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            24,
            598,
            105,
            22.0
          ],
          "hidden": 1,
          "id": "obj-36"
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            150,
            532,
            122,
            37.9
          ],
          "text": "bloom\n自走  0〜1",
          "fontsize": 11.0,
          "linecount": 2,
          "id": "obj-37"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "r mebuki_bloom",
          "numinlets": 0,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            220,
            572,
            112,
            22.0
          ],
          "hidden": 1,
          "id": "obj-38"
        }
      },
      {
        "box": {
          "maxclass": "flonum",
          "numinlets": 1,
          "numoutlets": 2,
          "patching_rect": [
            150,
            568,
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
          "id": "obj-39"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "prepend bloom",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            150,
            598,
            105,
            22.0
          ],
          "hidden": 1,
          "id": "obj-40"
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            276,
            532,
            122,
            37.9
          ],
          "text": "position\n位置  0〜1",
          "fontsize": 11.0,
          "linecount": 2,
          "id": "obj-41"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "r mebuki_position",
          "numinlets": 0,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            346,
            572,
            133,
            22.0
          ],
          "hidden": 1,
          "id": "obj-42"
        }
      },
      {
        "box": {
          "maxclass": "flonum",
          "numinlets": 1,
          "numoutlets": 2,
          "patching_rect": [
            276,
            568,
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
          "id": "obj-43"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "prepend position",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            276,
            598,
            126,
            22.0
          ],
          "hidden": 1,
          "id": "obj-44"
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            402,
            532,
            122,
            37.9
          ],
          "text": "scan\n時間の流れ  -1〜1",
          "fontsize": 11.0,
          "linecount": 2,
          "id": "obj-45"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "r mebuki_scan",
          "numinlets": 0,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            472,
            572,
            105,
            22.0
          ],
          "hidden": 1,
          "id": "obj-46"
        }
      },
      {
        "box": {
          "maxclass": "flonum",
          "numinlets": 1,
          "numoutlets": 2,
          "patching_rect": [
            402,
            568,
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
          "id": "obj-47"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "prepend scan",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            402,
            598,
            98,
            22.0
          ],
          "hidden": 1,
          "id": "obj-48"
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            528,
            532,
            122,
            37.9
          ],
          "text": "spray\n散り  0〜1",
          "fontsize": 11.0,
          "linecount": 2,
          "id": "obj-49"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "r mebuki_spray",
          "numinlets": 0,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            598,
            572,
            112,
            22.0
          ],
          "hidden": 1,
          "id": "obj-50"
        }
      },
      {
        "box": {
          "maxclass": "flonum",
          "numinlets": 1,
          "numoutlets": 2,
          "patching_rect": [
            528,
            568,
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
          "id": "obj-51"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "prepend spray",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            528,
            598,
            105,
            22.0
          ],
          "hidden": 1,
          "id": "obj-52"
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            654,
            532,
            122,
            37.9
          ],
          "text": "density\n密度 /秒  0.2〜200",
          "fontsize": 11.0,
          "linecount": 2,
          "id": "obj-53"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "r mebuki_density",
          "numinlets": 0,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            724,
            572,
            126,
            22.0
          ],
          "hidden": 1,
          "id": "obj-54"
        }
      },
      {
        "box": {
          "maxclass": "flonum",
          "numinlets": 1,
          "numoutlets": 2,
          "patching_rect": [
            654,
            568,
            74,
            22
          ],
          "outlettype": [
            "",
            "bang"
          ],
          "minimum": 0.2,
          "maximum": 200.0,
          "numdecimalplaces": 1,
          "format": 6,
          "id": "obj-55"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "prepend density",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            654,
            598,
            119,
            22.0
          ],
          "hidden": 1,
          "id": "obj-56"
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            24,
            616,
            122,
            37.9
          ],
          "text": "grainsize\n粒長 ms  5〜2000",
          "fontsize": 11.0,
          "linecount": 2,
          "id": "obj-57"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "r mebuki_grainsize",
          "numinlets": 0,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            94,
            656,
            140,
            22.0
          ],
          "hidden": 1,
          "id": "obj-58"
        }
      },
      {
        "box": {
          "maxclass": "flonum",
          "numinlets": 1,
          "numoutlets": 2,
          "patching_rect": [
            24,
            652,
            74,
            22
          ],
          "outlettype": [
            "",
            "bang"
          ],
          "minimum": 5.0,
          "maximum": 2000.0,
          "numdecimalplaces": 0,
          "format": 6,
          "id": "obj-59"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "prepend grainsize",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            24,
            682,
            133,
            22.0
          ],
          "hidden": 1,
          "id": "obj-60"
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            150,
            616,
            122,
            37.9
          ],
          "text": "pitch\n音高 半音  -24〜24",
          "fontsize": 11.0,
          "linecount": 2,
          "id": "obj-61"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "r mebuki_pitch",
          "numinlets": 0,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            220,
            656,
            112,
            22.0
          ],
          "hidden": 1,
          "id": "obj-62"
        }
      },
      {
        "box": {
          "maxclass": "flonum",
          "numinlets": 1,
          "numoutlets": 2,
          "patching_rect": [
            150,
            652,
            74,
            22
          ],
          "outlettype": [
            "",
            "bang"
          ],
          "minimum": -24.0,
          "maximum": 24.0,
          "numdecimalplaces": 1,
          "format": 6,
          "id": "obj-63"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "prepend pitch",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            150,
            682,
            105,
            22.0
          ],
          "hidden": 1,
          "id": "obj-64"
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            276,
            616,
            122,
            37.9
          ],
          "text": "pspray\n音高の散り  0〜24",
          "fontsize": 11.0,
          "linecount": 2,
          "id": "obj-65"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "r mebuki_pspray",
          "numinlets": 0,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            346,
            656,
            119,
            22.0
          ],
          "hidden": 1,
          "id": "obj-66"
        }
      },
      {
        "box": {
          "maxclass": "flonum",
          "numinlets": 1,
          "numoutlets": 2,
          "patching_rect": [
            276,
            652,
            74,
            22
          ],
          "outlettype": [
            "",
            "bang"
          ],
          "minimum": 0.0,
          "maximum": 24.0,
          "numdecimalplaces": 1,
          "format": 6,
          "id": "obj-67"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "prepend pspray",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            276,
            682,
            112,
            22.0
          ],
          "hidden": 1,
          "id": "obj-68"
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            402,
            616,
            122,
            37.9
          ],
          "text": "toy\n五音に丸める  on/off",
          "fontsize": 11.0,
          "linecount": 2,
          "id": "obj-69"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "r mebuki_toy",
          "numinlets": 0,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            472,
            656,
            98,
            22.0
          ],
          "hidden": 1,
          "id": "obj-70"
        }
      },
      {
        "box": {
          "maxclass": "toggle",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            402,
            652,
            24,
            24
          ],
          "outlettype": [
            "int"
          ],
          "id": "obj-71"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "prepend toy",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            402,
            682,
            91,
            22.0
          ],
          "hidden": 1,
          "id": "obj-72"
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            528,
            616,
            122,
            37.9
          ],
          "text": "rev\n逆再生率  0〜1",
          "fontsize": 11.0,
          "linecount": 2,
          "id": "obj-73"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "r mebuki_rev",
          "numinlets": 0,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            598,
            656,
            98,
            22.0
          ],
          "hidden": 1,
          "id": "obj-74"
        }
      },
      {
        "box": {
          "maxclass": "flonum",
          "numinlets": 1,
          "numoutlets": 2,
          "patching_rect": [
            528,
            652,
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
          "id": "obj-75"
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
            528,
            682,
            91,
            22.0
          ],
          "hidden": 1,
          "id": "obj-76"
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            654,
            616,
            122,
            37.9
          ],
          "text": "width\n広がり  0〜1",
          "fontsize": 11.0,
          "linecount": 2,
          "id": "obj-77"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "r mebuki_width",
          "numinlets": 0,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            724,
            656,
            112,
            22.0
          ],
          "hidden": 1,
          "id": "obj-78"
        }
      },
      {
        "box": {
          "maxclass": "flonum",
          "numinlets": 1,
          "numoutlets": 2,
          "patching_rect": [
            654,
            652,
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
          "id": "obj-79"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "prepend width",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            654,
            682,
            105,
            22.0
          ],
          "hidden": 1,
          "id": "obj-80"
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            24,
            700,
            122,
            37.9
          ],
          "text": "level\n音量  0〜1",
          "fontsize": 11.0,
          "linecount": 2,
          "id": "obj-81"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "r mebuki_level",
          "numinlets": 0,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            94,
            740,
            112,
            22.0
          ],
          "hidden": 1,
          "id": "obj-82"
        }
      },
      {
        "box": {
          "maxclass": "flonum",
          "numinlets": 1,
          "numoutlets": 2,
          "patching_rect": [
            24,
            736,
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
          "id": "obj-83"
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
            766,
            105,
            22.0
          ],
          "hidden": 1,
          "id": "obj-84"
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
            862,
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
                  "code": "// harimaze / MEBUKI - texture bloom\r\n// Grains drawn from two sources. Morph decides which source each new grain\r\n// comes from, so a second texture slowly sprouts inside the first.\r\n// Bloom lets the morph wander by itself. Scan moves the reading position\r\n// through time, forwards or backwards; 0 stops time.\r\n// in1  : trigger (rising edge spawns a grain now)\r\n// out1 : left    out2 : right\r\n// out3 : scan position 0..1    out4 : current morph 0..1\r\n\r\nBuffer srca(\"hz_mebuki_a\");\r\nBuffer srcb(\"hz_mebuki_b\");\r\nData gr(12, 8);\r\n\r\nParam morph(0);\r\nParam bloom(0.3);\r\nParam position(0.2);\r\nParam scan(0.05);\r\nParam spray(0.05);\r\nParam density(14);\r\nParam grainsize(180);\r\nParam pitch(0);\r\nParam pspray(0);\r\nParam toy(0);\r\nParam rev(0.15);\r\nParam width(0.6);\r\nParam level(0.8);\r\n\r\nHistory gtimer(0);\r\nHistory scanpos(0);\r\nHistory mwander(0);\r\nHistory trigprev(0);\r\n\r\nla = max(dim(srca), 2);\r\nlb = max(dim(srcb), 2);\r\nt0 = gtimer - 1;\r\nsc = scanpos;\r\nw = mwander;\r\ntrig = (in1 > 0.5) * (trigprev <= 0.5);\r\n\r\nslot = -1;\r\ni = 0;\r\nsb = 0;\r\nbl = 0;\r\nst = 0;\r\nsemis = 0;\r\noct = 0;\r\ndeg = 0;\r\nqd = 0;\r\ninc = 1;\r\ndur = 1;\r\npn = 0.5;\r\ndens = 1;\r\n\r\nsc = wrap(sc + scan / la, 0, 1);\r\nw = clamp(w * 0.99998 + noise() * bloom * 0.0006, -1, 1);\r\nmo = clamp(morph + w, 0, 1);\r\n\r\n// spawn a grain in the first free voice\r\nif (t0 <= 0 || trig > 0) {\r\n\tdens = clamp(density, 0.2, 200);\r\n\tt0 = samplerate / dens * (0.5 + (noise() * 0.5 + 0.5));\r\n\tfor (i = 0; i < 12; i += 1) {\r\n\t\tif (slot < 0) {\r\n\t\t\tif (peek(gr, i, 0) < 0.5) {\r\n\t\t\t\tslot = i;\r\n\t\t\t}\r\n\t\t}\r\n\t}\r\n\tif (slot >= 0) {\r\n\t\tsb = 0;\r\n\t\tif ((noise() * 0.5 + 0.5) < mo) {\r\n\t\t\tsb = 1;\r\n\t\t}\r\n\t\tbl = la;\r\n\t\tif (sb > 0) {\r\n\t\t\tbl = lb;\r\n\t\t}\r\n\t\tst = wrap(position + sc + spray * noise() * 0.5, 0, 1) * bl;\r\n\t\tsemis = pitch + pspray * noise();\r\n\t\tif (toy > 0.5) {\r\n\t\t\t// snap to a major pentatonic: 0 2 4 7 9\r\n\t\t\toct = floor(semis / 12);\r\n\t\t\tdeg = semis - oct * 12;\r\n\t\t\tqd = 0;\r\n\t\t\tif (deg >= 1) {\r\n\t\t\t\tqd = 2;\r\n\t\t\t}\r\n\t\t\tif (deg >= 3) {\r\n\t\t\t\tqd = 4;\r\n\t\t\t}\r\n\t\t\tif (deg >= 5.5) {\r\n\t\t\t\tqd = 7;\r\n\t\t\t}\r\n\t\t\tif (deg >= 8) {\r\n\t\t\t\tqd = 9;\r\n\t\t\t}\r\n\t\t\tif (deg >= 10.5) {\r\n\t\t\t\tqd = 12;\r\n\t\t\t}\r\n\t\t\tsemis = oct * 12 + qd;\r\n\t\t}\r\n\t\tinc = pow(2, semis / 12);\r\n\t\tif ((noise() * 0.5 + 0.5) < rev) {\r\n\t\t\tinc = 0 - inc;\r\n\t\t}\r\n\t\tdur = max(mstosamps(grainsize * (0.75 + 0.5 * (noise() * 0.5 + 0.5))), 64);\r\n\t\tpn = clamp(0.5 + width * noise() * 0.5, 0, 1);\r\n\t\tpoke(gr, 1, slot, 0);\r\n\t\tpoke(gr, st, slot, 1);\r\n\t\tpoke(gr, inc, slot, 2);\r\n\t\tpoke(gr, 0, slot, 3);\r\n\t\tpoke(gr, dur, slot, 4);\r\n\t\tpoke(gr, sqrt(1 - pn), slot, 5);\r\n\t\tpoke(gr, sqrt(pn), slot, 6);\r\n\t\tpoke(gr, sb, slot, 7);\r\n\t}\r\n}\r\n\r\n// render the voices\r\nsumL = 0;\r\nsumR = 0;\r\ngp = 0;\r\ngi = 0;\r\nga = 0;\r\ngd = 1;\r\ngs = 0;\r\nrpos = 0;\r\nk0 = 0;\r\nk1 = 0;\r\nkf = 0;\r\nv = 0;\r\nwv = 0;\r\nfor (i = 0; i < 12; i += 1) {\r\n\tif (peek(gr, i, 0) > 0.5) {\r\n\t\tgp = peek(gr, i, 1);\r\n\t\tgi = peek(gr, i, 2);\r\n\t\tga = peek(gr, i, 3);\r\n\t\tgd = peek(gr, i, 4);\r\n\t\tgs = peek(gr, i, 7);\r\n\t\tv = 0;\r\n\t\tif (gs > 0.5) {\r\n\t\t\trpos = wrap(gp, 0, lb);\r\n\t\t\tk0 = floor(rpos);\r\n\t\t\tkf = rpos - k0;\r\n\t\t\tk1 = wrap(k0 + 1, 0, lb);\r\n\t\t\tv = mix(peek(srcb, k0, 0), peek(srcb, k1, 0), kf);\r\n\t\t} else {\r\n\t\t\trpos = wrap(gp, 0, la);\r\n\t\t\tk0 = floor(rpos);\r\n\t\t\tkf = rpos - k0;\r\n\t\t\tk1 = wrap(k0 + 1, 0, la);\r\n\t\t\tv = mix(peek(srca, k0, 0), peek(srca, k1, 0), kf);\r\n\t\t}\r\n\t\twv = 0.5 - 0.5 * cos(twopi * ga / gd);\r\n\t\tv = v * wv;\r\n\t\tsumL += v * peek(gr, i, 5);\r\n\t\tsumR += v * peek(gr, i, 6);\r\n\t\tga = ga + 1;\r\n\t\tpoke(gr, gp + gi, i, 1);\r\n\t\tpoke(gr, ga, i, 3);\r\n\t\tif (ga >= gd) {\r\n\t\t\tpoke(gr, 0, i, 0);\r\n\t\t}\r\n\t}\r\n}\r\n\r\nov = clamp(density * grainsize / 1000, 1, 12);\r\nnrm = 1 / sqrt(ov);\r\nout1 = sumL * nrm * level;\r\nout2 = sumR * nrm * level;\r\nout3 = wrap(position + sc, 0, 1);\r\nout4 = mo;\r\n\r\ngtimer = t0;\r\nscanpos = sc;\r\nmwander = w;\r\ntrigprev = in1;\r\n",
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
          "id": "obj-85"
        }
      },
      {
        "box": {
          "maxclass": "button",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            24,
            820,
            26,
            26
          ],
          "outlettype": [
            "bang"
          ],
          "id": "obj-86"
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
            822,
            56,
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
            112,
            824,
            640,
            21.95
          ],
          "text": "● 粒をひとつ出す（in1 の立ち上がりで grain を生成。リズムで駆動すると粒が拍に乗る）",
          "fontsize": 11.0,
          "id": "obj-88"
        }
      },
      {
        "box": {
          "maxclass": "panel",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            12,
            792,
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
          "id": "obj-89"
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            24,
            798,
            700,
            23.4
          ],
          "text": "3  マシン MACHINE — gen~ をダブルクリックするとコードが見られます",
          "fontsize": 12.0,
          "fontface": 1,
          "id": "obj-90"
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
            906,
            60,
            22.0
          ],
          "id": "obj-91"
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
            906,
            60,
            22.0
          ],
          "id": "obj-92"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "r mebuki_master",
          "numinlets": 0,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            96,
            876,
            119,
            22.0
          ],
          "hidden": 1,
          "id": "obj-93"
        }
      },
      {
        "box": {
          "maxclass": "flonum",
          "numinlets": 1,
          "numoutlets": 2,
          "patching_rect": [
            96,
            906,
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
          "id": "obj-94"
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            160,
            908,
            60,
            21.95
          ],
          "text": "master",
          "fontsize": 11.0,
          "id": "obj-95"
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
            934,
            77,
            22.0
          ],
          "hidden": 1,
          "id": "obj-96"
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
            960,
            49,
            22.0
          ],
          "hidden": 1,
          "id": "obj-97"
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
            852,
            98,
            22.0
          ],
          "hidden": 1,
          "id": "obj-98"
        }
      },
      {
        "box": {
          "maxclass": "ezdac~",
          "numinlets": 2,
          "numoutlets": 0,
          "patching_rect": [
            24,
            946,
            45,
            45
          ],
          "id": "obj-99"
        }
      },
      {
        "box": {
          "maxclass": "meter~",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            76,
            946,
            12,
            45
          ],
          "outlettype": [
            "float"
          ],
          "id": "obj-100"
        }
      },
      {
        "box": {
          "maxclass": "meter~",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            92,
            946,
            12,
            45
          ],
          "outlettype": [
            "float"
          ],
          "id": "obj-101"
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            110,
            958,
            150,
            21.95
          ],
          "text": "← クリックで音を出す",
          "fontsize": 11.0,
          "id": "obj-102"
        }
      },
      {
        "box": {
          "maxclass": "message",
          "numinlets": 2,
          "numoutlets": 1,
          "patching_rect": [
            270,
            946,
            44,
            22.0
          ],
          "outlettype": [
            ""
          ],
          "text": "open",
          "id": "obj-103"
        }
      },
      {
        "box": {
          "maxclass": "toggle",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            318,
            946,
            22,
            22
          ],
          "outlettype": [
            "int"
          ],
          "id": "obj-104"
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
            976,
            90,
            22.0
          ],
          "id": "obj-105"
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            346,
            948,
            170,
            36.45
          ],
          "text": "録音: open で保存先 → トグルで開始/停止",
          "fontsize": 10.5,
          "linecount": 2,
          "id": "obj-106"
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
            906,
            90,
            22.0
          ],
          "id": "obj-107"
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
            906,
            90,
            22.0
          ],
          "id": "obj-108"
        }
      },
      {
        "box": {
          "maxclass": "slider",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            516,
            946,
            140,
            18
          ],
          "outlettype": [
            ""
          ],
          "floatoutput": 1,
          "size": 1.0,
          "ignoreclick": 1,
          "id": "obj-109"
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            516,
            968,
            145,
            36.45
          ],
          "text": "読み取り位置 (out3)",
          "fontsize": 10.5,
          "linecount": 2,
          "id": "obj-110"
        }
      },
      {
        "box": {
          "maxclass": "flonum",
          "numinlets": 1,
          "numoutlets": 2,
          "patching_rect": [
            664,
            946,
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
          "id": "obj-111"
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            664,
            968,
            118,
            36.45
          ],
          "text": "いまの morph (out4)\n0 = A, 1 = B",
          "fontsize": 10.5,
          "linecount": 2,
          "id": "obj-112"
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
            360
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
            150,
            360,
            23.4
          ],
          "text": "プリセット PRESETS — ● を押す",
          "fontsize": 12.0,
          "fontface": 1,
          "id": "obj-114"
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
          "id": "obj-115"
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
          "id": "obj-116"
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
          "text": "霧 mist",
          "fontsize": 13.0,
          "fontface": 1,
          "id": "obj-117"
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
          "text": "A だけの長い粒。ゆっくり前へ",
          "fontsize": 10.5,
          "id": "obj-118"
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
          "text": "; mebuki_morph 0; mebuki_bloom 0.2; mebuki_position 0.2; mebuki_scan 0.02; mebuki_spray 0.1; mebuki_density 30; mebuki_grainsize 400; mebuki_pitch 0; mebuki_pspray 0; mebuki_toy 0; mebuki_rev 0.15; mebuki_width 0.6; mebuki_level 0.8",
          "id": "obj-119"
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
          "id": "obj-120"
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
          "text": "芽 sprout",
          "fontsize": 13.0,
          "fontface": 1,
          "id": "obj-121"
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
          "text": "B がときどき顔を出す",
          "fontsize": 10.5,
          "id": "obj-122"
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
          "text": "; mebuki_morph 0.25; mebuki_bloom 0.6; mebuki_scan 0.05; mebuki_density 18; mebuki_grainsize 220",
          "id": "obj-123"
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
          "id": "obj-124"
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
          "text": "開花 bloom",
          "fontsize": 13.0,
          "fontface": 1,
          "id": "obj-125"
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
          "text": "B が地になり、A が残り香になる",
          "fontsize": 10.5,
          "id": "obj-126"
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
          "text": "; mebuki_morph 0.8; mebuki_bloom 0.4; mebuki_density 40; mebuki_grainsize 150; mebuki_pspray 3",
          "id": "obj-127"
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
          "id": "obj-128"
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
          "text": "おもちゃ toy",
          "fontsize": 13.0,
          "fontface": 1,
          "id": "obj-129"
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
          "text": "五音音階に丸めた短い粒",
          "fontsize": 10.5,
          "id": "obj-130"
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
          "text": "; mebuki_morph 0.5; mebuki_toy 1; mebuki_pspray 12; mebuki_density 8; mebuki_grainsize 90; mebuki_rev 0.3",
          "id": "obj-131"
        }
      },
      {
        "box": {
          "maxclass": "button",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            800,
            436,
            26,
            26
          ],
          "outlettype": [
            "bang"
          ],
          "id": "obj-132"
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            834,
            438,
            330,
            24.849999999999998
          ],
          "text": "逆流 backwards",
          "fontsize": 13.0,
          "fontface": 1,
          "id": "obj-133"
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            834,
            458,
            340,
            21.225
          ],
          "text": "時間が戻っていく",
          "fontsize": 10.5,
          "id": "obj-134"
        }
      },
      {
        "box": {
          "maxclass": "message",
          "numinlets": 2,
          "numoutlets": 1,
          "patching_rect": [
            1000,
            436,
            170,
            22.0
          ],
          "outlettype": [
            ""
          ],
          "hidden": 1,
          "text": "; mebuki_scan -0.4; mebuki_spray 0.03; mebuki_density 50; mebuki_grainsize 300; mebuki_toy 0; mebuki_pspray 0",
          "id": "obj-135"
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            800,
            520,
            380,
            101.7
          ],
          "text": "使い方\n1. 右下の ezdac~（スピーカー）をクリックして DSP を ON\n2. プリセットの ● を押す（起動時は 1 番目が入ります）\n3. 数字をドラッグして変える。音源はドロップで差し替え\n同梱音源（jongly.aif など）は Max 付属のサンプルです。\n見つからない場合は自分のファイルをドロップしてください。",
          "fontsize": 11.0,
          "linecount": 6,
          "id": "obj-136"
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
            "obj-19",
            0
          ],
          "destination": [
            "obj-27",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-20",
            0
          ],
          "destination": [
            "obj-27",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-21",
            0
          ],
          "destination": [
            "obj-27",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-22",
            0
          ],
          "destination": [
            "obj-27",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-24",
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
            "obj-27",
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
            "obj-28",
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
            "obj-35",
            0
          ],
          "destination": [
            "obj-36",
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
            "obj-39",
            0
          ],
          "destination": [
            "obj-40",
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
            "obj-43",
            0
          ],
          "destination": [
            "obj-44",
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
            "obj-51",
            0
          ],
          "destination": [
            "obj-52",
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
            "obj-55",
            0
          ],
          "destination": [
            "obj-56",
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
            "obj-70",
            0
          ],
          "destination": [
            "obj-71",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-71",
            0
          ],
          "destination": [
            "obj-72",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-74",
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
            "obj-80",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-82",
            0
          ],
          "destination": [
            "obj-83",
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
            "obj-84",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-36",
            0
          ],
          "destination": [
            "obj-85",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-40",
            0
          ],
          "destination": [
            "obj-85",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-44",
            0
          ],
          "destination": [
            "obj-85",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-48",
            0
          ],
          "destination": [
            "obj-85",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-52",
            0
          ],
          "destination": [
            "obj-85",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-56",
            0
          ],
          "destination": [
            "obj-85",
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
            "obj-85",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-64",
            0
          ],
          "destination": [
            "obj-85",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-68",
            0
          ],
          "destination": [
            "obj-85",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-72",
            0
          ],
          "destination": [
            "obj-85",
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
            "obj-85",
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
            "obj-85",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-84",
            0
          ],
          "destination": [
            "obj-85",
            0
          ],
          "hidden": 1
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
            "obj-87",
            0
          ],
          "destination": [
            "obj-85",
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
            "obj-91",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-85",
            1
          ],
          "destination": [
            "obj-92",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-93",
            0
          ],
          "destination": [
            "obj-94",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-98",
            0
          ],
          "destination": [
            "obj-94",
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
            "obj-96",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-96",
            0
          ],
          "destination": [
            "obj-97",
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
            "obj-91",
            1
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
            "obj-92",
            1
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
            "obj-99",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-92",
            0
          ],
          "destination": [
            "obj-99",
            1
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-91",
            0
          ],
          "destination": [
            "obj-100",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-92",
            0
          ],
          "destination": [
            "obj-101",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-103",
            0
          ],
          "destination": [
            "obj-105",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-104",
            0
          ],
          "destination": [
            "obj-105",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-91",
            0
          ],
          "destination": [
            "obj-105",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-92",
            0
          ],
          "destination": [
            "obj-105",
            1
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-85",
            2
          ],
          "destination": [
            "obj-107",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-85",
            3
          ],
          "destination": [
            "obj-108",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-107",
            0
          ],
          "destination": [
            "obj-109",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-108",
            0
          ],
          "destination": [
            "obj-111",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-116",
            0
          ],
          "destination": [
            "obj-119",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-115",
            0
          ],
          "destination": [
            "obj-119",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-120",
            0
          ],
          "destination": [
            "obj-123",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-124",
            0
          ],
          "destination": [
            "obj-127",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-128",
            0
          ],
          "destination": [
            "obj-131",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-132",
            0
          ],
          "destination": [
            "obj-135",
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