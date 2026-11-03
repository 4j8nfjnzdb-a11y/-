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
          "text": "KOSURI 擦 — scrub hand",
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
          "text": "レコードの台（モーター）と手の物理モデル。手がつかむとバネで針を引っぱるので、音程が手の動きに追従する。\nジェスチャーは自動で起きる：ベビー・スクラッチ、チャープ（戻りでフェーダーを切る）、トランスフォーマー（フェーダーを刻む）、\nスピンバック、ドラッグ。grab を ON にして hand のスライダーを動かすと、自分でこすれる。",
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
          "text": "文脈: 竹村延和の SCRUB / Philip Jeck・大友良英のターンテーブル",
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
          "text": "1  音源（レコード役）",
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
          "text": "buffer~ hz_kosuri_src 30000 2",
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
          "text": "loadmess set hz_kosuri_src",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            210,
            300,
            196,
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
          "text": "speed\nモーター  -2〜2",
          "fontsize": 11.0,
          "linecount": 2,
          "id": "obj-16"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "r kosuri_speed",
          "numinlets": 0,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            94,
            412,
            112,
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
          "text": "torque\nトルク  0〜1",
          "fontsize": 11.0,
          "linecount": 2,
          "id": "obj-20"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "r kosuri_torque",
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
          "text": "prepend torque",
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
          "text": "gesture\nジェスチャー頻度  0〜1",
          "fontsize": 11.0,
          "linecount": 2,
          "id": "obj-24"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "r kosuri_gesture",
          "numinlets": 0,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            346,
            412,
            126,
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
          "text": "prepend gesture",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            276,
            438,
            119,
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
          "text": "baby\nベビー  0〜1",
          "fontsize": 11.0,
          "linecount": 2,
          "id": "obj-28"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "r kosuri_baby",
          "numinlets": 0,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            472,
            412,
            105,
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
          "text": "prepend baby",
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
          "text": "chirp\nチャープ  0〜1",
          "fontsize": 11.0,
          "linecount": 2,
          "id": "obj-32"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "r kosuri_chirp",
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
          "text": "prepend chirp",
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
          "text": "transformer\nトランス  0〜1",
          "fontsize": 11.0,
          "linecount": 2,
          "id": "obj-36"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "r kosuri_transformer",
          "numinlets": 0,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            724,
            412,
            154,
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
          "text": "prepend transformer",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            654,
            438,
            147,
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
          "text": "spinback\nスピンバック  0〜1",
          "fontsize": 11.0,
          "linecount": 2,
          "id": "obj-40"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "r kosuri_spinback",
          "numinlets": 0,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            94,
            496,
            133,
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
          "text": "prepend spinback",
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
          "text": "drag\nドラッグ  0〜1",
          "fontsize": 11.0,
          "linecount": 2,
          "id": "obj-44"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "r kosuri_drag",
          "numinlets": 0,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            220,
            496,
            105,
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
          "text": "prepend drag",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            150,
            522,
            98,
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
          "text": "amount\n振れ幅 ms  10〜2000",
          "fontsize": 11.0,
          "linecount": 2,
          "id": "obj-48"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "r kosuri_amount",
          "numinlets": 0,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            346,
            496,
            119,
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
          "minimum": 10.0,
          "maximum": 2000.0,
          "numdecimalplaces": 0,
          "format": 6,
          "id": "obj-50"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "prepend amount",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            276,
            522,
            112,
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
          "text": "hz\n速さ Hz  0.1〜20",
          "fontsize": 11.0,
          "linecount": 2,
          "id": "obj-52"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "r kosuri_hz",
          "numinlets": 0,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            472,
            496,
            91,
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
          "minimum": 0.1,
          "maximum": 20.0,
          "numdecimalplaces": 2,
          "format": 6,
          "id": "obj-54"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "prepend hz",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            402,
            522,
            84,
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
          "text": "crackle\n針音  0〜1",
          "fontsize": 11.0,
          "linecount": 2,
          "id": "obj-56"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "r kosuri_crackle",
          "numinlets": 0,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            598,
            496,
            126,
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
          "text": "prepend crackle",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            528,
            522,
            119,
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
          "text": "grab\nつかむ  on/off",
          "fontsize": 11.0,
          "linecount": 2,
          "id": "obj-60"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "r kosuri_grab",
          "numinlets": 0,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            724,
            496,
            105,
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
          "text": "prepend grab",
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
          "text": "r kosuri_level",
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
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            150,
            540,
            122,
            37.9
          ],
          "text": "hand\n手の位置（grab 中）  0〜1",
          "fontsize": 11.0,
          "linecount": 2,
          "id": "obj-68"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "r kosuri_hand",
          "numinlets": 0,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            220,
            580,
            105,
            22.0
          ],
          "hidden": 1,
          "id": "obj-69"
        }
      },
      {
        "box": {
          "maxclass": "slider",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            150,
            576,
            244,
            20
          ],
          "outlettype": [
            ""
          ],
          "floatoutput": 1,
          "size": 1.0,
          "id": "obj-70"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "prepend hand",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            150,
            606,
            98,
            22.0
          ],
          "hidden": 1,
          "id": "obj-71"
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
                  "code": "// harimaze / KOSURI - scrub hand\r\n// A record platter with a motor and a hand. The motor turns the record at\r\n// speed; the hand grabs it and pulls the needle toward a target through a\r\n// spring, so pitch follows the hand. Gestures play themselves: baby\r\n// scratch, chirp (fader closes on the return stroke), transformer (fader\r\n// stutters), spinback, drag. Turn grab on and move hand to scrub yourself.\r\n// in1  : trigger (rising edge starts a gesture now)\r\n// out1 : left    out2 : right\r\n// out3 : needle position 0..1\r\n// out4 : 0 motor, 1 baby, 2 chirp, 3 transformer, 4 spinback, 5 drag, 6 hand\r\n\r\nBuffer src(\"hz_kosuri_src\");\r\n\r\nParam speed(1);\r\nParam torque(0.3);\r\nParam gesture(0.4);\r\nParam baby(0.5);\r\nParam chirp(0.3);\r\nParam transformer(0.3);\r\nParam spinback(0.2);\r\nParam drag(0.2);\r\nParam amount(250);\r\nParam hz(3);\r\nParam crackle(0.2);\r\nParam grab(0);\r\nParam hand(0.5);\r\nParam level(0.8);\r\n\r\nHistory ppos(0);\r\nHistory pvel(1);\r\nHistory gmode(0);\r\nHistory gtime(0);\r\nHistory gphase(0);\r\nHistory anchor(0);\r\nHistory fader(1);\r\nHistory etimer(48000);\r\nHistory crk(0);\r\nHistory trigprev(0);\r\nHistory dcx1(0);\r\nHistory dcy1(0);\r\nHistory dcx2(0);\r\nHistory dcy2(0);\r\n\r\nblen = max(dim(src), 2);\r\nch2 = 0;\r\nif (channels(src) > 1) {\r\n\tch2 = 1;\r\n}\r\npp = ppos;\r\nvv = pvel;\r\ngm = gmode;\r\ngtl = gtime - 1;\r\nph = gphase;\r\nan = anchor;\r\nfd = fader;\r\net = etimer - 1;\r\ntrig = (in1 > 0.5) * (trigprev <= 0.5);\r\nmanual = grab > 0.5;\r\nwsum = baby + chirp + transformer + spinback + drag;\r\nr = 0;\r\n\r\n// gesture engine (only while the hand is not on the record)\r\nif (manual < 0.5 && gm == 0 && (et <= 0 || trig > 0)) {\r\n\tet = mstosamps(mix(9000, 400, clamp(gesture, 0, 1)) * (0.5 + (noise() * 0.5 + 0.5)));\r\n\tif (wsum > 0.001 && (gesture > 0.001 || trig > 0)) {\r\n\t\tr = (noise() * 0.5 + 0.5) * wsum;\r\n\t\tgm = 5;\r\n\t\tif (r < baby + chirp + transformer + spinback) {\r\n\t\t\tgm = 4;\r\n\t\t}\r\n\t\tif (r < baby + chirp + transformer) {\r\n\t\t\tgm = 3;\r\n\t\t}\r\n\t\tif (r < baby + chirp) {\r\n\t\t\tgm = 2;\r\n\t\t}\r\n\t\tif (r < baby) {\r\n\t\t\tgm = 1;\r\n\t\t}\r\n\t\tgtl = mstosamps(600 + 1800 * (noise() * 0.5 + 0.5));\r\n\t\tif (gm == 4) {\r\n\t\t\tgtl = mstosamps(250 + 350 * (noise() * 0.5 + 0.5));\r\n\t\t}\r\n\t\tph = 0;\r\n\t\tan = pp;\r\n\t}\r\n}\r\nif (gm != 0) {\r\n\tif (gtl <= 0 || manual > 0.5) {\r\n\t\tgm = 0;\r\n\t}\r\n}\r\n\r\ngrip = 0;\r\ntgt = pp;\r\nmot = speed;\r\ntq = 0.0002 + clamp(torque, 0, 1) * 0.004;\r\nfdt = 1;\r\nph = ph + clamp(hz, 0.1, 30) / samplerate;\r\namp = mstosamps(amount);\r\nif (gm == 1) {\r\n\tgrip = 1;\r\n\ttgt = an + amp * 0.5 * sin(twopi * ph);\r\n}\r\nif (gm == 2) {\r\n\tgrip = 1;\r\n\ttgt = an + amp * 0.5 * sin(twopi * ph);\r\n\tif (cos(twopi * ph) < 0) {\r\n\t\tfdt = 0;\r\n\t}\r\n}\r\nif (gm == 3) {\r\n\tgrip = 1;\r\n\ttgt = an + amp * 0.5 * sin(twopi * ph * 0.5);\r\n\tif (ph * 4 - floor(ph * 4) > 0.5) {\r\n\t\tfdt = 0;\r\n\t}\r\n}\r\nif (gm == 4) {\r\n\tmot = speed * -8;\r\n\ttq = 0.01;\r\n}\r\nif (gm == 5) {\r\n\tmot = speed * 0.2;\r\n\ttq = 0.00004;\r\n}\r\nif (manual > 0.5) {\r\n\tgrip = 1;\r\n\ttgt = clamp(hand, 0, 1) * blen;\r\n}\r\n\r\n// platter physics: spring to the hand, or the motor's torque\r\nwn = twopi * 25 / samplerate;\r\ndd = wrap(tgt - pp, blen * -0.5, blen * 0.5);\r\nacc = grip * (wn * wn * dd - 1.6 * wn * vv) + (1 - grip) * tq * (mot - vv);\r\nvv = clamp(vv + acc, -16, 16);\r\npp = wrap(pp + vv, 0, blen);\r\nfd = fd + (fdt - fd) * 0.02;\r\n\r\ni0 = floor(pp);\r\nfr = pp - i0;\r\ni1 = wrap(i0 + 1, 0, blen);\r\nsL = mix(peek(src, i0, 0), peek(src, i1, 0), fr) * fd;\r\nsR = mix(peek(src, i0, ch2), peek(src, i1, ch2), fr) * fd;\r\n\r\n// vinyl: clicks and hiss\r\nck = crk * 0.55;\r\nif (noise() > 1 - clamp(crackle, 0, 1) * 0.0008) {\r\n\tck = ck + noise() * 0.6;\r\n}\r\nhs = noise() * clamp(crackle, 0, 1) * 0.008;\r\nsL = sL + ck + hs;\r\nsR = sR + ck * 0.8 - hs;\r\n\r\nyL = sL - dcx1 + 0.9995 * dcy1;\r\nyR = sR - dcx2 + 0.9995 * dcy2;\r\ndcx1 = sL;\r\ndcy1 = yL;\r\ndcx2 = sR;\r\ndcy2 = yR;\r\n\r\nst = gm;\r\nif (manual > 0.5) {\r\n\tst = 6;\r\n}\r\nout1 = yL * level;\r\nout2 = yR * level;\r\nout3 = pp / blen;\r\nout4 = st;\r\n\r\nppos = pp;\r\npvel = vv;\r\ngmode = gm;\r\ngtime = gtl;\r\ngphase = ph;\r\nanchor = an;\r\nfader = fd;\r\netimer = et;\r\ncrk = ck;\r\ntrigprev = in1;\r\n",
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
          "id": "obj-72"
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
          "id": "obj-73"
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
          "id": "obj-74"
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
          "text": "● 今すぐジェスチャー（in1 の立ち上がりで 1 回）",
          "fontsize": 11.0,
          "id": "obj-75"
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
          "id": "obj-76"
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
          "id": "obj-77"
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
          "id": "obj-78"
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
          "id": "obj-79"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "r kosuri_master",
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
          "id": "obj-80"
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
          "id": "obj-81"
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
          "id": "obj-82"
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
          "id": "obj-83"
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
          "id": "obj-84"
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
          "id": "obj-85"
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
          "id": "obj-86"
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
          "id": "obj-87"
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
          "id": "obj-88"
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
          "id": "obj-89"
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
          "id": "obj-90"
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
          "id": "obj-91"
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
          "id": "obj-92"
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
          "id": "obj-93"
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
          "id": "obj-94"
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
          "id": "obj-95"
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
          "id": "obj-96"
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
          "text": "針の位置 (out3)",
          "fontsize": 10.5,
          "linecount": 2,
          "id": "obj-97"
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
          "id": "obj-98"
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
            51.675
          ],
          "text": "動作 (out4) 0 モーター\n1 ベビー 2 チャープ 3 トランス\n4 スピン 5 ドラッグ 6 手",
          "fontsize": 10.5,
          "linecount": 3,
          "id": "obj-99"
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
          "id": "obj-100"
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
          "id": "obj-101"
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
            180,
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
            182,
            330,
            24.849999999999998
          ],
          "text": "回るだけ spin",
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
            202,
            340,
            21.225
          ],
          "text": "ジェスチャーなし。針音だけ",
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
            180,
            170,
            22.0
          ],
          "outlettype": [
            ""
          ],
          "hidden": 1,
          "text": "; kosuri_speed 1; kosuri_torque 0.3; kosuri_gesture 0; kosuri_baby 0.5; kosuri_chirp 0.3; kosuri_transformer 0.3; kosuri_spinback 0.2; kosuri_drag 0.2; kosuri_amount 250; kosuri_hz 3; kosuri_crackle 0.2; kosuri_grab 0; kosuri_level 0.8",
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
            244,
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
            246,
            330,
            24.849999999999998
          ],
          "text": "ベビー baby",
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
            266,
            340,
            21.225
          ],
          "text": "前後にこする基本形",
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
            244,
            170,
            22.0
          ],
          "outlettype": [
            ""
          ],
          "hidden": 1,
          "text": "; kosuri_gesture 0.5; kosuri_baby 1; kosuri_chirp 0.2; kosuri_transformer 0; kosuri_spinback 0; kosuri_drag 0; kosuri_amount 250; kosuri_hz 3",
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
            308,
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
            310,
            330,
            24.849999999999998
          ],
          "text": "ルーティン routine",
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
            330,
            340,
            21.225
          ],
          "text": "全部のジェスチャーを混ぜる",
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
            308,
            170,
            22.0
          ],
          "outlettype": [
            ""
          ],
          "hidden": 1,
          "text": "; kosuri_gesture 0.7; kosuri_baby 0.5; kosuri_chirp 0.5; kosuri_transformer 0.5; kosuri_spinback 0.3; kosuri_drag 0.3; kosuri_amount 300; kosuri_hz 4",
          "id": "obj-114"
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
          "id": "obj-115"
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
          "text": "夢の中 slow",
          "fontsize": 13.0,
          "fontface": 1,
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
            394,
            340,
            21.225
          ],
          "text": "半速の盤がゆっくり止まりかける",
          "fontsize": 10.5,
          "id": "obj-117"
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
          "text": "; kosuri_speed 0.5; kosuri_torque 0.05; kosuri_gesture 0.3; kosuri_baby 0.2; kosuri_chirp 0; kosuri_transformer 0; kosuri_spinback 0; kosuri_drag 1; kosuri_amount 900; kosuri_hz 0.5; kosuri_crackle 0.5",
          "id": "obj-118"
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
          "id": "obj-119"
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
            "obj-69",
            0
          ],
          "destination": [
            "obj-70",
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
            "obj-19",
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
            "obj-23",
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
            "obj-27",
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
            "obj-31",
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
            "obj-35",
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
            "obj-39",
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
            "obj-43",
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
            "obj-47",
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
            "obj-51",
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
            "obj-55",
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
            "obj-59",
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
            "obj-63",
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
            "obj-67",
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
            "obj-73",
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
            "obj-74",
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
            "obj-72",
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
            "obj-72",
            1
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
            "obj-80",
            0
          ],
          "destination": [
            "obj-81",
            0
          ],
          "hidden": 1
        }
      },
      {
        "patchline": {
          "source": [
            "obj-85",
            0
          ],
          "destination": [
            "obj-81",
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
            "obj-84",
            0
          ],
          "destination": [
            "obj-78",
            1
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
            "obj-79",
            1
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
            "obj-86",
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
            "obj-86",
            1
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-78",
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
            "obj-79",
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
            "obj-92",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-78",
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
            "obj-79",
            0
          ],
          "destination": [
            "obj-92",
            1
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-72",
            2
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
            "obj-72",
            3
          ],
          "destination": [
            "obj-95",
            0
          ]
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
            "obj-106",
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
      },
      {
        "patchline": {
          "source": [
            "obj-115",
            0
          ],
          "destination": [
            "obj-118",
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