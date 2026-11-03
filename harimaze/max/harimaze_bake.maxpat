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
          "text": "BAKE 化け — databending",
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
          "text": "壊れたデコーダーのように音を読む。バイトの入れ替え、ビット反転（XOR）、符号の読み違い、ビット深度の削り、\nモノラルをステレオと読み違える、サンプルレートの読み違い、ブロックの繰り返し、位置の読み違い。\nときどき「ファイルが腐って」故障の組み合わせが入れ替わる（rot）。補間なしの生の読み出し。",
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
          "text": "文脈: 刀根康尚・Oval の「正しく再生する仕組み」の出し抜き / Pontiac Streator のグリッチ / 文字化けの音版",
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
          "text": "buffer~ hz_bake_src 30000 2",
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
          "text": "loadmess set hz_bake_src",
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
          "text": "speed\n速度  -2〜2",
          "fontsize": 11.0,
          "linecount": 2,
          "id": "obj-16"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "r bake_speed",
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
          "minimum": -2.0,
          "maximum": 2.0,
          "numdecimalplaces": 3,
          "format": 6,
          "id": "obj-18"
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
          "text": "rot\n腐る頻度  0〜1",
          "fontsize": 11.0,
          "linecount": 2,
          "id": "obj-20"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "r bake_rot",
          "numinlets": 0,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            220,
            412,
            84,
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
          "text": "prepend rot",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            150,
            438,
            91,
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
          "text": "flip\nビット反転  0〜1",
          "fontsize": 11.0,
          "linecount": 2,
          "id": "obj-24"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "r bake_flip",
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
          "text": "prepend flip",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            276,
            438,
            98,
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
          "text": "byteswap\nバイト入替  0〜1",
          "fontsize": 11.0,
          "linecount": 2,
          "id": "obj-28"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "r bake_byteswap",
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
          "text": "prepend byteswap",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            402,
            438,
            126,
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
          "text": "signerr\n符号の誤読  0〜1",
          "fontsize": 11.0,
          "linecount": 2,
          "id": "obj-32"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "r bake_signerr",
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
          "text": "prepend signerr",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            528,
            438,
            119,
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
          "text": "bits\nビット深度  1〜16",
          "fontsize": 11.0,
          "linecount": 2,
          "id": "obj-36"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "r bake_bits",
          "numinlets": 0,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            724,
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
            654,
            408,
            74,
            22
          ],
          "outlettype": [
            "",
            "bang"
          ],
          "minimum": 1.0,
          "maximum": 16.0,
          "numdecimalplaces": 0,
          "format": 6,
          "id": "obj-38"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "prepend bits",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            654,
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
            24,
            456,
            122,
            37.9
          ],
          "text": "srate\nレート誤読  0〜1",
          "fontsize": 11.0,
          "linecount": 2,
          "id": "obj-40"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "r bake_srate",
          "numinlets": 0,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            94,
            496,
            98,
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
          "text": "prepend srate",
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
          "text": "interleave\nステレオ誤読  0〜1",
          "fontsize": 11.0,
          "linecount": 2,
          "id": "obj-44"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "r bake_interleave",
          "numinlets": 0,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            220,
            496,
            133,
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
          "text": "prepend interleave",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            150,
            522,
            140,
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
          "text": "stutter\nブロック反復  0〜1",
          "fontsize": 11.0,
          "linecount": 2,
          "id": "obj-48"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "r bake_stutter",
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
          "text": "prepend stutter",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            276,
            522,
            119,
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
          "text": "blocksize\nブロック ms  2〜500",
          "fontsize": 11.0,
          "linecount": 2,
          "id": "obj-52"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "r bake_blocksize",
          "numinlets": 0,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            472,
            496,
            126,
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
          "minimum": 2.0,
          "maximum": 500.0,
          "numdecimalplaces": 0,
          "format": 6,
          "id": "obj-54"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "prepend blocksize",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            402,
            522,
            133,
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
          "text": "jump\n位置飛び  0〜1",
          "fontsize": 11.0,
          "linecount": 2,
          "id": "obj-56"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "r bake_jump",
          "numinlets": 0,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            598,
            496,
            91,
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
          "text": "prepend jump",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            528,
            522,
            98,
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
          "text": "tame\nなだめる  0〜1",
          "fontsize": 11.0,
          "linecount": 2,
          "id": "obj-60"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "r bake_tame",
          "numinlets": 0,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            724,
            496,
            91,
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
            654,
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
          "text": "prepend tame",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            654,
            522,
            98,
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
          "text": "r bake_level",
          "numinlets": 0,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            94,
            580,
            98,
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
                  "code": "// harimaze / BAKE - databending\r\n// Reads the audio the way a broken decoder would: bytes swapped, bits\r\n// flipped (XOR mask), the sign bit misread, depth cut, mono read as\r\n// interleaved stereo, the wrong sample rate, blocks repeated, the read\r\n// head thrown to a wrong offset. Every so often the \"file\" rots and the\r\n// faults re-roll. No interpolation anywhere: raw sample reads.\r\n// in1  : trigger (rising edge re-rolls the faults now)\r\n// out1 : left    out2 : right\r\n// out3 : read position 0..1    out4 : number of active faults 0..6\r\n\r\nBuffer src(\"hz_bake_src\");\r\n\r\nParam speed(1);\r\nParam rot(0.3);\r\nParam flip(0.3);\r\nParam byteswap(0.2);\r\nParam signerr(0.15);\r\nParam bits(16);\r\nParam srate(0.3);\r\nParam interleave(0.2);\r\nParam stutter(0.3);\r\nParam blocksize(40);\r\nParam jump(0.2);\r\nParam tame(0.3);\r\nParam level(0.6);\r\n\r\nHistory pos(0);\r\nHistory etimer(0);\r\nHistory mask(0);\r\nHistory fswap(0);\r\nHistory fsign(0);\r\nHistory finter(0);\r\nHistory rmul(1);\r\nHistory bcnt(0);\r\nHistory bstart(0);\r\nHistory flash(0);\r\nHistory trigprev(0);\r\nHistory lp1(0);\r\nHistory lp2(0);\r\nHistory dcx1(0);\r\nHistory dcy1(0);\r\nHistory dcx2(0);\r\nHistory dcy2(0);\r\n\r\nblen = max(dim(src), 2);\r\nch2 = 0;\r\nif (channels(src) > 1) {\r\n\tch2 = 1;\r\n}\r\npp = pos;\r\net = etimer - 1;\r\nmsk = mask;\r\nfsw = fswap;\r\nfsg = fsign;\r\nfil = finter;\r\nrm = rmul;\r\nbc = bcnt + 1;\r\nbs = bstart;\r\nfl = max(flash - 1, 0);\r\ntrig = (in1 > 0.5) * (trigprev <= 0.5);\r\nnb = 1;\r\nk = 0;\r\nsv = 0;\r\nu = 0;\r\nhi = 0;\r\na = 0;\r\nb = 0;\r\nxr = 0;\r\npw = 1;\r\nq = 1;\r\nia = 0;\r\n\r\n// rot: the faults re-roll\r\nif (et <= 0 || trig > 0) {\r\n\tet = mstosamps(mix(9000, 120, clamp(rot, 0, 1)) * (0.4 + 1.2 * (noise() * 0.5 + 0.5)));\r\n\tif (rot > 0.001 || trig > 0) {\r\n\t\tmsk = 0;\r\n\t\tif (flip > 0.001) {\r\n\t\t\tnb = 1 + floor(clamp(flip, 0, 1) * 15);\r\n\t\t\tmsk = floor((noise() * 0.5 + 0.5) * pow(2, nb));\r\n\t\t}\r\n\t\tfsw = (noise() * 0.5 + 0.5) < byteswap;\r\n\t\tfsg = (noise() * 0.5 + 0.5) < signerr;\r\n\t\tfil = (noise() * 0.5 + 0.5) < interleave;\r\n\t\trm = 1;\r\n\t\tif ((noise() * 0.5 + 0.5) < srate) {\r\n\t\t\tk = floor((noise() * 0.5 + 0.5) * 6);\r\n\t\t\trm = 0.5;\r\n\t\t\tif (k == 1) {\r\n\t\t\t\trm = 2;\r\n\t\t\t}\r\n\t\t\tif (k == 2) {\r\n\t\t\t\trm = 0.91875;\r\n\t\t\t}\r\n\t\t\tif (k == 3) {\r\n\t\t\t\trm = 1.08844;\r\n\t\t\t}\r\n\t\t\tif (k == 4) {\r\n\t\t\t\trm = 0.75;\r\n\t\t\t}\r\n\t\t\tif (k == 5) {\r\n\t\t\t\trm = 1.5;\r\n\t\t\t}\r\n\t\t}\r\n\t\tif ((noise() * 0.5 + 0.5) < jump) {\r\n\t\t\tpp = floor((noise() * 0.5 + 0.5) * blen / 4096) * 4096;\r\n\t\t\tfl = mstosamps(150);\r\n\t\t}\r\n\t}\r\n}\r\n\r\n// blocks: at each boundary the decoder may replay the block it just read\r\nif (bc >= max(mstosamps(blocksize), 16)) {\r\n\tbc = 0;\r\n\tif ((noise() * 0.5 + 0.5) < stutter) {\r\n\t\tpp = bs;\r\n\t} else {\r\n\t\tbs = pp;\r\n\t}\r\n}\r\npp = wrap(pp + speed * rm, 0, blen);\r\n\r\nix = floor(pp);\r\nxL = peek(src, ix, 0);\r\nxR = peek(src, ix, ch2);\r\nif (fil > 0.5) {\r\n\tia = wrap(ix * 2, 0, blen);\r\n\txL = peek(src, ia, 0);\r\n\txR = peek(src, wrap(ia + 1, 0, blen), 0);\r\n}\r\nq = pow(2, 16 - clamp(floor(bits), 1, 16));\r\n\r\n// left channel through the faults (16-bit integer view)\r\nsv = clamp(floor(xL * 32767), -32768, 32767);\r\nu = sv;\r\nif (u < 0) {\r\n\tu = u + 65536;\r\n}\r\nif (fsw > 0.5) {\r\n\thi = floor(u / 256);\r\n\tu = (u - hi * 256) * 256 + hi;\r\n}\r\nif (msk > 0) {\r\n\ta = u;\r\n\tb = msk;\r\n\txr = 0;\r\n\tpw = 1;\r\n\tfor (k = 0; k < 16; k += 1) {\r\n\t\tif ((a - 2 * floor(a / 2)) != (b - 2 * floor(b / 2))) {\r\n\t\t\txr = xr + pw;\r\n\t\t}\r\n\t\ta = floor(a / 2);\r\n\t\tb = floor(b / 2);\r\n\t\tpw = pw * 2;\r\n\t}\r\n\tu = xr;\r\n}\r\nif (fsg > 0.5) {\r\n\tu = wrap(u + 32768, 0, 65536);\r\n}\r\nu = floor(u / q) * q;\r\nif (u >= 32768) {\r\n\tu = u - 65536;\r\n}\r\nyL = u / 32768;\r\n\r\n// right channel, same faults\r\nsv = clamp(floor(xR * 32767), -32768, 32767);\r\nu = sv;\r\nif (u < 0) {\r\n\tu = u + 65536;\r\n}\r\nif (fsw > 0.5) {\r\n\thi = floor(u / 256);\r\n\tu = (u - hi * 256) * 256 + hi;\r\n}\r\nif (msk > 0) {\r\n\ta = u;\r\n\tb = msk;\r\n\txr = 0;\r\n\tpw = 1;\r\n\tfor (k = 0; k < 16; k += 1) {\r\n\t\tif ((a - 2 * floor(a / 2)) != (b - 2 * floor(b / 2))) {\r\n\t\t\txr = xr + pw;\r\n\t\t}\r\n\t\ta = floor(a / 2);\r\n\t\tb = floor(b / 2);\r\n\t\tpw = pw * 2;\r\n\t}\r\n\tu = xr;\r\n}\r\nif (fsg > 0.5) {\r\n\tu = wrap(u + 32768, 0, 65536);\r\n}\r\nu = floor(u / q) * q;\r\nif (u >= 32768) {\r\n\tu = u - 65536;\r\n}\r\nyR = u / 32768;\r\n\r\n// tame: a one-pole low-pass to take the edge off\r\ncut = mix(1, 0.06, clamp(tame, 0, 1));\r\na1 = lp1 + (yL - lp1) * cut;\r\na2 = lp2 + (yR - lp2) * cut;\r\noL = a1 - dcx1 + 0.999 * dcy1;\r\noR = a2 - dcx2 + 0.999 * dcy2;\r\ndcx1 = a1;\r\ndcy1 = oL;\r\ndcx2 = a2;\r\ndcy2 = oR;\r\n\r\nnf = (msk > 0) + (fsw > 0.5) + (fsg > 0.5) + (fil > 0.5) + (rm != 1) + (bits < 16);\r\nout1 = oL * level;\r\nout2 = oR * level;\r\nout3 = pp / blen;\r\nout4 = nf;\r\n\r\npos = pp;\r\netimer = et;\r\nmask = msk;\r\nfswap = fsw;\r\nfsign = fsg;\r\nfinter = fil;\r\nrmul = rm;\r\nbcnt = bc;\r\nbstart = bs;\r\nflash = fl;\r\ntrigprev = in1;\r\nlp1 = a1;\r\nlp2 = a2;\r\n",
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
          "id": "obj-68"
        }
      },
      {
        "box": {
          "maxclass": "button",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            24,
            660,
            26,
            26
          ],
          "outlettype": [
            "bang"
          ],
          "id": "obj-69"
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
            662,
            56,
            22.0
          ],
          "id": "obj-70"
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            112,
            664,
            640,
            21.95
          ],
          "text": "● 今すぐ故障を入れ替える（in1 の立ち上がりで rot を 1 回起こす）",
          "fontsize": 11.0,
          "id": "obj-71"
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
          "id": "obj-72"
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
            24,
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
          "id": "obj-75"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "r bake_master",
          "numinlets": 0,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            96,
            716,
            105,
            22.0
          ],
          "hidden": 1,
          "id": "obj-76"
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
          "id": "obj-77"
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
          "id": "obj-78"
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
          "id": "obj-79"
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
          "id": "obj-80"
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
          "id": "obj-81"
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
          "id": "obj-82"
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
          "id": "obj-83"
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
          "id": "obj-84"
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
          "id": "obj-85"
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
          "id": "obj-86"
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
          "id": "obj-87"
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
          "id": "obj-88"
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
            516,
            746,
            90,
            22.0
          ],
          "id": "obj-90"
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
          "id": "obj-91"
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
          "id": "obj-92"
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
          "text": "読み取り位置 (out3)",
          "fontsize": 10.5,
          "linecount": 2,
          "id": "obj-93"
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
          "id": "obj-94"
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
          "text": "故障の数 (out4)\n0〜6",
          "fontsize": 10.5,
          "linecount": 2,
          "id": "obj-95"
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
          "id": "obj-96"
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
          "id": "obj-97"
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
            180,
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
            182,
            330,
            24.849999999999998
          ],
          "text": "軽い化け light",
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
            202,
            340,
            21.225
          ],
          "text": "ときどき読み違える程度",
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
            180,
            170,
            22.0
          ],
          "outlettype": [
            ""
          ],
          "hidden": 1,
          "text": "; bake_speed 1; bake_rot 0.2; bake_flip 0.15; bake_byteswap 0.05; bake_signerr 0; bake_bits 16; bake_srate 0.2; bake_interleave 0.1; bake_stutter 0.2; bake_blocksize 60; bake_jump 0.1; bake_tame 0.4; bake_level 0.6",
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
            244,
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
            246,
            330,
            24.849999999999998
          ],
          "text": "文字化け mojibake",
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
            266,
            340,
            21.225
          ],
          "text": "いろいろな読み違いが入れ替わる",
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
            244,
            170,
            22.0
          ],
          "outlettype": [
            ""
          ],
          "hidden": 1,
          "text": "; bake_rot 0.5; bake_flip 0.4; bake_byteswap 0.4; bake_signerr 0.3; bake_bits 12; bake_srate 0.4; bake_interleave 0.3; bake_stutter 0.4; bake_blocksize 30; bake_jump 0.3; bake_tame 0.3",
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
            308,
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
            310,
            330,
            24.849999999999998
          ],
          "text": "破損ファイル corrupt",
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
            330,
            340,
            21.225
          ],
          "text": "ほぼ読めない。短いブロックが暴れる",
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
            308,
            170,
            22.0
          ],
          "outlettype": [
            ""
          ],
          "hidden": 1,
          "text": "; bake_rot 0.8; bake_flip 0.8; bake_byteswap 0.6; bake_signerr 0.5; bake_bits 8; bake_srate 0.6; bake_interleave 0.5; bake_stutter 0.6; bake_blocksize 12; bake_jump 0.5; bake_tame 0.2; bake_level 0.5",
          "id": "obj-110"
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
            374,
            330,
            24.849999999999998
          ],
          "text": "8 ビット 8bit",
          "fontsize": 13.0,
          "fontface": 1,
          "id": "obj-112"
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
          "text": "深度を削ってレートを読み違える",
          "fontsize": 10.5,
          "id": "obj-113"
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
          "text": "; bake_rot 0.3; bake_flip 0; bake_byteswap 0; bake_signerr 0; bake_bits 6; bake_srate 0.5; bake_interleave 0; bake_stutter 0.3; bake_blocksize 80; bake_jump 0.1; bake_tame 0.5",
          "id": "obj-114"
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
          "id": "obj-115"
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
            "obj-70",
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
            "obj-68",
            0
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
            "obj-74",
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
            "obj-75",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-76",
            0
          ],
          "destination": [
            "obj-77",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-81",
            0
          ],
          "destination": [
            "obj-77",
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
            "obj-80",
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
            "obj-80",
            0
          ],
          "destination": [
            "obj-75",
            1
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
            "obj-82",
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
            "obj-82",
            1
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
            "obj-75",
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
            "obj-88",
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
            "obj-88",
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
            "obj-88",
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
            "obj-90",
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
            "obj-92",
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
            "obj-94",
            0
          ]
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
            "obj-98",
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
      },
      {
        "patchline": {
          "source": [
            "obj-111",
            0
          ],
          "destination": [
            "obj-114",
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