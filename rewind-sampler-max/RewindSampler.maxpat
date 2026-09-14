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
   40.0,
   1400.0,
   900.0
  ],
  "bglocked": 0,
  "openinpresentation": 0,
  "default_fontsize": 11.0,
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
  "boxanimatetime": 200,
  "enablehscroll": 1,
  "enablevscroll": 1,
  "devicewidth": 0.0,
  "boxes": [
   {
    "box": {
     "id": "adc",
     "maxclass": "newobj",
     "numinlets": 0,
     "numoutlets": 2,
     "outlettype": [
      "signal",
      "signal"
     ],
     "patching_rect": [
      40,
      40,
      140,
      22
     ],
     "text": "adc~ 1 2"
    }
   },
   {
    "box": {
     "id": "c_adc",
     "maxclass": "comment",
     "numinlets": 1,
     "numoutlets": 0,
     "outlettype": [],
     "patching_rect": [
      200,
      86,
      320,
      22
     ],
     "text": "Fireface 802 の入力ch選択。3/4を使う場合は adc~ 3 4 に書き換え"
    }
   },
   {
    "box": {
     "id": "bufL",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "patching_rect": [
      40,
      132,
      140,
      22
     ],
     "text": "buffer~ bufL 300000 1"
    }
   },
   {
    "box": {
     "id": "bufR",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "patching_rect": [
      40,
      178,
      140,
      22
     ],
     "text": "buffer~ bufR 300000 1"
    }
   },
   {
    "box": {
     "id": "c_buf",
     "maxclass": "comment",
     "numinlets": 1,
     "numoutlets": 0,
     "outlettype": [],
     "patching_rect": [
      200,
      224,
      320,
      22
     ],
     "text": "5分バッファ(300000ms)。20分にするなら1200000へ書き換えて再読込"
    }
   },
   {
    "box": {
     "id": "recL",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 0,
     "outlettype": [],
     "patching_rect": [
      40,
      270,
      140,
      22
     ],
     "text": "record~ bufL 1"
    }
   },
   {
    "box": {
     "id": "recR",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 0,
     "outlettype": [],
     "patching_rect": [
      40,
      316,
      140,
      22
     ],
     "text": "record~ bufR 1"
    }
   },
   {
    "box": {
     "id": "loadbang",
     "maxclass": "newobj",
     "numinlets": 0,
     "numoutlets": 1,
     "outlettype": [
      "bang"
     ],
     "patching_rect": [
      40,
      362,
      140,
      22
     ],
     "text": "loadbang"
    }
   },
   {
    "box": {
     "id": "t_init",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 5,
     "outlettype": [
      "bang",
      "bang",
      "bang",
      "bang",
      "bang"
     ],
     "patching_rect": [
      40,
      408,
      140,
      22
     ],
     "text": "t b b b b b"
    }
   },
   {
    "box": {
     "id": "m_mixinit",
     "maxclass": "message",
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      700,
      454,
      100,
      22
     ]
    }
   },
   {
    "box": {
     "id": "delay_trail",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 1,
     "outlettype": [
      "bang"
     ],
     "patching_rect": [
      820,
      500,
      140,
      22
     ],
     "text": "delay 800"
    }
   },
   {
    "box": {
     "id": "m_loop1",
     "maxclass": "message",
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      200,
      546,
      100,
      22
     ]
    }
   },
   {
    "box": {
     "id": "m_recstart",
     "maxclass": "message",
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      340,
      592,
      100,
      22
     ]
    }
   },
   {
    "box": {
     "id": "m_clkstart",
     "maxclass": "message",
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      460,
      638,
      100,
      22
     ]
    }
   },
   {
    "box": {
     "id": "m_metropoll1",
     "maxclass": "message",
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      580,
      684,
      100,
      22
     ]
    }
   },
   {
    "box": {
     "id": "clk",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "bang"
     ],
     "patching_rect": [
      40,
      40,
      140,
      22
     ],
     "text": "metro 20"
    }
   },
   {
    "box": {
     "id": "elapsed_acc",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      40,
      86,
      140,
      22
     ],
     "text": "float 0"
    }
   },
   {
    "box": {
     "id": "elapsed_add",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      40,
      40,
      140,
      22
     ],
     "text": "+ 20"
    }
   },
   {
    "box": {
     "id": "min_clip",
     "maxclass": "newobj",
     "numinlets": 3,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      200,
      86,
      140,
      22
     ],
     "text": "clip 0 300000"
    }
   },
   {
    "box": {
     "id": "mod_write",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      340,
      132,
      140,
      22
     ],
     "text": "% 300000"
    }
   },
   {
    "box": {
     "id": "store_writepos",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      200,
      132,
      140,
      22
     ],
     "text": "float"
    }
   },
   {
    "box": {
     "id": "c_wp",
     "maxclass": "comment",
     "numinlets": 1,
     "numoutlets": 0,
     "outlettype": [],
     "patching_rect": [
      340,
      178,
      300,
      22
     ],
     "text": "writePositionMs: 循環バッファ内での現在の書き込み位置"
    }
   },
   {
    "box": {
     "id": "metro_poll",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "bang"
     ],
     "patching_rect": [
      40,
      178,
      140,
      22
     ],
     "text": "metro 50"
    }
   },
   {
    "box": {
     "id": "snap",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      40,
      224,
      140,
      22
     ],
     "text": "snapshot~"
    }
   },
   {
    "box": {
     "id": "store_readpos",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      40,
      270,
      140,
      22
     ],
     "text": "float"
    }
   },
   {
    "box": {
     "id": "c_rp",
     "maxclass": "comment",
     "numinlets": 1,
     "numoutlets": 0,
     "outlettype": [],
     "patching_rect": [
      200,
      316,
      320,
      22
     ],
     "text": "store_readpos: 現在の再生(過去)位置。ループ始点/終点のマーキングに使用"
    }
   },
   {
    "box": {
     "id": "grooveL",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 3,
     "outlettype": [
      "signal",
      "signal",
      "bang"
     ],
     "patching_rect": [
      40,
      40,
      140,
      22
     ],
     "text": "groove~ bufL"
    }
   },
   {
    "box": {
     "id": "grooveR",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 3,
     "outlettype": [
      "signal",
      "signal",
      "bang"
     ],
     "patching_rect": [
      40,
      86,
      140,
      22
     ],
     "text": "groove~ bufR"
    }
   },
   {
    "box": {
     "id": "mixSlider",
     "maxclass": "slider",
     "numinlets": 0,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      40,
      40,
      140,
      22
     ]
    }
   },
   {
    "box": {
     "id": "mix_div",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      40,
      86,
      140,
      22
     ],
     "text": "/ 127."
    }
   },
   {
    "box": {
     "id": "mix_t",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 2,
     "outlettype": [
      "float",
      "float"
     ],
     "patching_rect": [
      40,
      132,
      140,
      22
     ],
     "text": "t f f"
    }
   },
   {
    "box": {
     "id": "dry_calc",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      200,
      178,
      140,
      22
     ],
     "text": "expr 1.-$f1"
    }
   },
   {
    "box": {
     "id": "dry_pack",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      200,
      224,
      140,
      22
     ],
     "text": "pack 0. 20"
    }
   },
   {
    "box": {
     "id": "dry_line",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "patching_rect": [
      200,
      270,
      140,
      22
     ],
     "text": "line~"
    }
   },
   {
    "box": {
     "id": "wet_pack",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      340,
      316,
      140,
      22
     ],
     "text": "pack 0. 20"
    }
   },
   {
    "box": {
     "id": "wet_line",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "patching_rect": [
      340,
      362,
      140,
      22
     ],
     "text": "line~"
    }
   },
   {
    "box": {
     "id": "dryL_mult",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "patching_rect": [
      40,
      40,
      140,
      22
     ],
     "text": "*~"
    }
   },
   {
    "box": {
     "id": "dryR_mult",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "patching_rect": [
      40,
      86,
      140,
      22
     ],
     "text": "*~"
    }
   },
   {
    "box": {
     "id": "wetL_mult",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "patching_rect": [
      200,
      132,
      140,
      22
     ],
     "text": "*~"
    }
   },
   {
    "box": {
     "id": "wetR_mult",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "patching_rect": [
      200,
      178,
      140,
      22
     ],
     "text": "*~"
    }
   },
   {
    "box": {
     "id": "sumL",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "patching_rect": [
      40,
      40,
      140,
      22
     ],
     "text": "+~"
    }
   },
   {
    "box": {
     "id": "sumR",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "patching_rect": [
      200,
      86,
      140,
      22
     ],
     "text": "+~"
    }
   },
   {
    "box": {
     "id": "dac",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 0,
     "outlettype": [],
     "patching_rect": [
      40,
      132,
      140,
      22
     ],
     "text": "dac~ 1 2"
    }
   },
   {
    "box": {
     "id": "c_mix",
     "maxclass": "comment",
     "numinlets": 1,
     "numoutlets": 0,
     "outlettype": [],
     "patching_rect": [
      460,
      408,
      300,
      22
     ],
     "text": "ミックスフェーダー: 上げるほど原音が消えて過去(groove~)が鳴る"
    }
   },
   {
    "box": {
     "id": "pitchSlider",
     "maxclass": "slider",
     "numinlets": 0,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      40,
      40,
      140,
      22
     ]
    }
   },
   {
    "box": {
     "id": "pitch_expr",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      40,
      86,
      220,
      22
     ],
     "text": "expr pow(2., ($f1-63.5)/63.5)"
    }
   },
   {
    "box": {
     "id": "store_ratemag",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      40,
      132,
      140,
      22
     ],
     "text": "float 1."
    }
   },
   {
    "box": {
     "id": "direction_float",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      200,
      178,
      140,
      22
     ],
     "text": "float 1"
    }
   },
   {
    "box": {
     "id": "rate_mult",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      40,
      40,
      140,
      22
     ],
     "text": "*"
    }
   },
   {
    "box": {
     "id": "c_pitch",
     "maxclass": "comment",
     "numinlets": 1,
     "numoutlets": 0,
     "outlettype": [],
     "patching_rect": [
      340,
      224,
      320,
      22
     ],
     "text": "ピッチフェーダー: 中央=変化なし、左右で連続的に±1オクターブ(微分音域を含む)"
    }
   },
   {
    "box": {
     "id": "enterTrail",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 3,
     "outlettype": [
      "bang",
      "bang",
      "bang"
     ],
     "patching_rect": [
      40,
      40,
      140,
      22
     ],
     "text": "t b b b"
    }
   },
   {
    "box": {
     "id": "m_dirplus1",
     "maxclass": "message",
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      200,
      86,
      100,
      22
     ]
    }
   },
   {
    "box": {
     "id": "trail_sub",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      340,
      132,
      140,
      22
     ],
     "text": "- 3000"
    }
   },
   {
    "box": {
     "id": "trail_max",
     "maxclass": "newobj",
     "numinlets": 3,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      340,
      178,
      140,
      22
     ],
     "text": "clip 0. 300000."
    }
   },
   {
    "box": {
     "id": "c_trail",
     "maxclass": "comment",
     "numinlets": 1,
     "numoutlets": 0,
     "outlettype": [],
     "patching_rect": [
      460,
      224,
      320,
      22
     ],
     "text": "enterTrail: 通常再生に戻る(約3秒トレイル)。Rewind/Miracle/Loopのどれを解除しても実行"
    }
   },
   {
    "box": {
     "id": "rewindToggle",
     "maxclass": "toggle",
     "numinlets": 1,
     "numoutlets": 1,
     "outlettype": [
      "int"
     ],
     "patching_rect": [
      40,
      40,
      140,
      22
     ]
    }
   },
   {
    "box": {
     "id": "rewind_sel",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 3,
     "outlettype": [
      "bang",
      "bang",
      "int"
     ],
     "patching_rect": [
      40,
      86,
      140,
      22
     ],
     "text": "sel 0 1"
    }
   },
   {
    "box": {
     "id": "rewindOn_t",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 2,
     "outlettype": [
      "bang",
      "bang"
     ],
     "patching_rect": [
      200,
      132,
      140,
      22
     ],
     "text": "t b b"
    }
   },
   {
    "box": {
     "id": "m_dirminus1",
     "maxclass": "message",
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      340,
      178,
      100,
      22
     ]
    }
   },
   {
    "box": {
     "id": "c_rewind",
     "maxclass": "comment",
     "numinlets": 1,
     "numoutlets": 0,
     "outlettype": [],
     "patching_rect": [
      460,
      224,
      320,
      22
     ],
     "text": "巻き戻しトグル: ONで逆再生(ピッチフェーダーの速さで)。OFFでトレイルに復帰"
    }
   },
   {
    "box": {
     "id": "liveButton",
     "maxclass": "button",
     "numinlets": 1,
     "numoutlets": 1,
     "outlettype": [
      "bang"
     ],
     "patching_rect": [
      40,
      40,
      140,
      22
     ]
    }
   },
   {
    "box": {
     "id": "jumpButton",
     "maxclass": "button",
     "numinlets": 1,
     "numoutlets": 1,
     "outlettype": [
      "bang"
     ],
     "patching_rect": [
      40,
      40,
      140,
      22
     ]
    }
   },
   {
    "box": {
     "id": "jumpSecondsBox",
     "maxclass": "flonum",
     "numinlets": 1,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      200,
      86,
      140,
      22
     ],
     "parameter_enable": 0
    }
   },
   {
    "box": {
     "id": "jumpT",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 2,
     "outlettype": [
      "bang",
      "bang"
     ],
     "patching_rect": [
      40,
      40,
      140,
      22
     ],
     "text": "t b b"
    }
   },
   {
    "box": {
     "id": "pos_sub",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      200,
      86,
      140,
      22
     ],
     "text": "-"
    }
   },
   {
    "box": {
     "id": "wrap_add",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      200,
      132,
      140,
      22
     ],
     "text": "+ 300000"
    }
   },
   {
    "box": {
     "id": "wrap_mod",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      200,
      178,
      140,
      22
     ],
     "text": "% 300000"
    }
   },
   {
    "box": {
     "id": "jump_ms",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      340,
      224,
      140,
      22
     ],
     "text": "* 1000."
    }
   },
   {
    "box": {
     "id": "c_jump",
     "maxclass": "comment",
     "numinlets": 1,
     "numoutlets": 0,
     "outlettype": [],
     "patching_rect": [
      460,
      132,
      260,
      22
     ],
     "text": "ジャンプ: 「何秒前」のNo.を入れてボタンを押す"
    }
   },
   {
    "box": {
     "id": "loopButton",
     "maxclass": "button",
     "numinlets": 1,
     "numoutlets": 1,
     "outlettype": [
      "bang"
     ],
     "patching_rect": [
      40,
      40,
      140,
      22
     ]
    }
   },
   {
    "box": {
     "id": "loopState",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      200,
      86,
      140,
      22
     ],
     "text": "float 0"
    }
   },
   {
    "box": {
     "id": "loopState_inc",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      340,
      132,
      140,
      22
     ],
     "text": "+ 1"
    }
   },
   {
    "box": {
     "id": "loopState_wrap",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      340,
      178,
      140,
      22
     ],
     "text": "% 3"
    }
   },
   {
    "box": {
     "id": "sel_loop",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 4,
     "outlettype": [
      "bang",
      "bang",
      "bang",
      "int"
     ],
     "patching_rect": [
      40,
      40,
      140,
      22
     ],
     "text": "sel 0 1 2"
    }
   },
   {
    "box": {
     "id": "loopStart_f",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      200,
      86,
      140,
      22
     ],
     "text": "float"
    }
   },
   {
    "box": {
     "id": "loopEnd_f",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      340,
      132,
      140,
      22
     ],
     "text": "float"
    }
   },
   {
    "box": {
     "id": "loop_pack",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      480,
      178,
      140,
      22
     ],
     "text": "pack 0. 0."
    }
   },
   {
    "box": {
     "id": "confirm_t",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 2,
     "outlettype": [
      "bang",
      "bang"
     ],
     "patching_rect": [
      200,
      40,
      140,
      22
     ],
     "text": "t b b"
    }
   },
   {
    "box": {
     "id": "m_setloop",
     "maxclass": "message",
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      480,
      40,
      140,
      22
     ]
    }
   },
   {
    "box": {
     "id": "m_loopon",
     "maxclass": "message",
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      200,
      86,
      100,
      22
     ]
    }
   },
   {
    "box": {
     "id": "confirmDir_t",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 2,
     "outlettype": [
      "bang",
      "bang"
     ],
     "patching_rect": [
      40,
      86,
      140,
      22
     ],
     "text": "t b b"
    }
   },
   {
    "box": {
     "id": "m_dirplus1b",
     "maxclass": "message",
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      40,
      132,
      100,
      22
     ]
    }
   },
   {
    "box": {
     "id": "m_loopoff",
     "maxclass": "message",
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      40,
      40,
      100,
      22
     ]
    }
   },
   {
    "box": {
     "id": "c_loop",
     "maxclass": "comment",
     "numinlets": 1,
     "numoutlets": 0,
     "outlettype": [],
     "patching_rect": [
      620,
      224,
      320,
      22
     ],
     "text": "ループ: 1回目で始点セット, 2回目で終点確定してループ再生, 3回目で解除"
    }
   },
   {
    "box": {
     "id": "loopShiftSecondsBox",
     "maxclass": "flonum",
     "numinlets": 1,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      40,
      40,
      140,
      22
     ]
    }
   },
   {
    "box": {
     "id": "loopShiftBackBtn",
     "maxclass": "button",
     "numinlets": 1,
     "numoutlets": 1,
     "outlettype": [
      "bang"
     ],
     "patching_rect": [
      200,
      86,
      140,
      22
     ]
    }
   },
   {
    "box": {
     "id": "loopShiftFwdBtn",
     "maxclass": "button",
     "numinlets": 1,
     "numoutlets": 1,
     "outlettype": [
      "bang"
     ],
     "patching_rect": [
      340,
      132,
      140,
      22
     ]
    }
   },
   {
    "box": {
     "id": "shiftBack_t",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 2,
     "outlettype": [
      "bang",
      "bang"
     ],
     "patching_rect": [
      200,
      40,
      140,
      22
     ],
     "text": "t b b"
    }
   },
   {
    "box": {
     "id": "shiftBack_ms",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      200,
      40,
      140,
      22
     ],
     "text": "* -1000."
    }
   },
   {
    "box": {
     "id": "shiftFwd_t",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 2,
     "outlettype": [
      "bang",
      "bang"
     ],
     "patching_rect": [
      340,
      86,
      140,
      22
     ],
     "text": "t b b"
    }
   },
   {
    "box": {
     "id": "shiftFwd_ms",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      340,
      86,
      140,
      22
     ],
     "text": "* 1000."
    }
   },
   {
    "box": {
     "id": "shiftApply_t",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 4,
     "outlettype": [
      "bang",
      "bang",
      "float",
      "float"
     ],
     "patching_rect": [
      40,
      40,
      140,
      22
     ],
     "text": "t b b f f"
    }
   },
   {
    "box": {
     "id": "shiftStart_add",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      200,
      40,
      140,
      22
     ],
     "text": "+"
    }
   },
   {
    "box": {
     "id": "shiftStart_wrapA",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      200,
      86,
      140,
      22
     ],
     "text": "+ 300000"
    }
   },
   {
    "box": {
     "id": "shiftStart_wrapM",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      200,
      132,
      140,
      22
     ],
     "text": "% 300000"
    }
   },
   {
    "box": {
     "id": "shiftEnd_add",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      340,
      178,
      140,
      22
     ],
     "text": "+"
    }
   },
   {
    "box": {
     "id": "shiftEnd_wrapA",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      340,
      224,
      140,
      22
     ],
     "text": "+ 300000"
    }
   },
   {
    "box": {
     "id": "shiftEnd_wrapM",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      340,
      270,
      140,
      22
     ],
     "text": "% 300000"
    }
   },
   {
    "box": {
     "id": "m_setloop2",
     "maxclass": "message",
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      480,
      40,
      140,
      22
     ]
    }
   },
   {
    "box": {
     "id": "c_shift",
     "maxclass": "comment",
     "numinlets": 1,
     "numoutlets": 0,
     "outlettype": [],
     "patching_rect": [
      620,
      178,
      320,
      22
     ],
     "text": "ループを秒数分だけ過去/未来へ移動(長さは維持)。ピッチはそのまま"
    }
   },
   {
    "box": {
     "id": "c_shift2",
     "maxclass": "comment",
     "numinlets": 1,
     "numoutlets": 0,
     "outlettype": [],
     "patching_rect": [
      40,
      86,
      260,
      22
     ],
     "text": "先にループを確定(2回押し)してから使ってください"
    }
   },
   {
    "box": {
     "id": "miracleToggle",
     "maxclass": "toggle",
     "numinlets": 1,
     "numoutlets": 1,
     "outlettype": [
      "int"
     ],
     "patching_rect": [
      40,
      40,
      140,
      22
     ]
    }
   },
   {
    "box": {
     "id": "miracle_sel",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 3,
     "outlettype": [
      "bang",
      "bang",
      "int"
     ],
     "patching_rect": [
      40,
      86,
      140,
      22
     ],
     "text": "sel 0 1"
    }
   },
   {
    "box": {
     "id": "miracleChunkMsBox",
     "maxclass": "number",
     "numinlets": 1,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      200,
      132,
      140,
      22
     ]
    }
   },
   {
    "box": {
     "id": "metro_miracle",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "bang"
     ],
     "patching_rect": [
      40,
      40,
      140,
      22
     ],
     "text": "metro 1200"
    }
   },
   {
    "box": {
     "id": "miracleOn_t",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 2,
     "outlettype": [
      "bang",
      "bang"
     ],
     "patching_rect": [
      200,
      178,
      140,
      22
     ],
     "text": "t b b"
    }
   },
   {
    "box": {
     "id": "m_loop0_m",
     "maxclass": "message",
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      340,
      224,
      100,
      22
     ]
    }
   },
   {
    "box": {
     "id": "m_metromiracle1",
     "maxclass": "message",
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      460,
      270,
      100,
      22
     ]
    }
   },
   {
    "box": {
     "id": "miracleOff_t",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 2,
     "outlettype": [
      "bang",
      "bang"
     ],
     "patching_rect": [
      200,
      86,
      140,
      22
     ],
     "text": "t b b"
    }
   },
   {
    "box": {
     "id": "m_metromiracle0",
     "maxclass": "message",
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      340,
      132,
      100,
      22
     ]
    }
   },
   {
    "box": {
     "id": "mTick_t",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 4,
     "outlettype": [
      "bang",
      "bang",
      "bang",
      "bang"
     ],
     "patching_rect": [
      40,
      40,
      140,
      22
     ],
     "text": "t b b b b"
    }
   },
   {
    "box": {
     "id": "random_dir",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      200,
      86,
      140,
      22
     ],
     "text": "random 2"
    }
   },
   {
    "box": {
     "id": "dir_scale",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      200,
      40,
      140,
      22
     ],
     "text": "* 2"
    }
   },
   {
    "box": {
     "id": "dir_offset",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      200,
      40,
      140,
      22
     ],
     "text": "- 1"
    }
   },
   {
    "box": {
     "id": "mDir_f",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      200,
      40,
      140,
      22
     ],
     "text": "float"
    }
   },
   {
    "box": {
     "id": "random_speed",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      340,
      132,
      140,
      22
     ],
     "text": "random 180"
    }
   },
   {
    "box": {
     "id": "speed_expr",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      340,
      86,
      200,
      22
     ],
     "text": "expr 0.6+($f1/180.)*1.8"
    }
   },
   {
    "box": {
     "id": "mRate_mult",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      340,
      86,
      140,
      22
     ],
     "text": "*"
    }
   },
   {
    "box": {
     "id": "random_age",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      40,
      132,
      140,
      22
     ],
     "text": "random 1"
    }
   },
   {
    "box": {
     "id": "c_miracle",
     "maxclass": "comment",
     "numinlets": 1,
     "numoutlets": 0,
     "outlettype": [],
     "patching_rect": [
      460,
      316,
      340,
      22
     ],
     "text": "Miracle: 0.5〜3秒目安のランダム断片を順逆・速度ランダムで再生。長さはchunk(ms)で調整"
    }
   }
  ],
  "lines": [
   {
    "patchline": {
     "source": [
      "adc",
      0
     ],
     "destination": [
      "recL",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "adc",
      1
     ],
     "destination": [
      "recR",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "loadbang",
      0
     ],
     "destination": [
      "t_init",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "t_init",
      4
     ],
     "destination": [
      "m_mixinit",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "m_mixinit",
      0
     ],
     "destination": [
      "mix_div",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "t_init",
      4
     ],
     "destination": [
      "delay_trail",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "delay_trail",
      0
     ],
     "destination": [
      "enterTrail",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "t_init",
      3
     ],
     "destination": [
      "m_loop1",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "t_init",
      2
     ],
     "destination": [
      "m_recstart",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "t_init",
      1
     ],
     "destination": [
      "m_clkstart",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "t_init",
      0
     ],
     "destination": [
      "m_metropoll1",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "m_loop1",
      0
     ],
     "destination": [
      "recL",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "m_loop1",
      0
     ],
     "destination": [
      "recR",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "m_recstart",
      0
     ],
     "destination": [
      "recL",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "m_recstart",
      0
     ],
     "destination": [
      "recR",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "m_clkstart",
      0
     ],
     "destination": [
      "clk",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "clk",
      0
     ],
     "destination": [
      "elapsed_acc",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "elapsed_acc",
      0
     ],
     "destination": [
      "elapsed_add",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "elapsed_add",
      0
     ],
     "destination": [
      "elapsed_acc",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "elapsed_add",
      0
     ],
     "destination": [
      "min_clip",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "elapsed_add",
      0
     ],
     "destination": [
      "mod_write",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "mod_write",
      0
     ],
     "destination": [
      "store_writepos",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "m_metropoll1",
      0
     ],
     "destination": [
      "metro_poll",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "metro_poll",
      0
     ],
     "destination": [
      "snap",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "snap",
      0
     ],
     "destination": [
      "store_readpos",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "grooveL",
      1
     ],
     "destination": [
      "snap",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "mixSlider",
      0
     ],
     "destination": [
      "mix_div",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "mix_div",
      0
     ],
     "destination": [
      "mix_t",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "mix_t",
      1
     ],
     "destination": [
      "dry_calc",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "dry_calc",
      0
     ],
     "destination": [
      "dry_pack",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "dry_pack",
      0
     ],
     "destination": [
      "dry_line",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "mix_t",
      0
     ],
     "destination": [
      "wet_pack",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "wet_pack",
      0
     ],
     "destination": [
      "wet_line",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "adc",
      0
     ],
     "destination": [
      "dryL_mult",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "adc",
      1
     ],
     "destination": [
      "dryR_mult",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "dry_line",
      0
     ],
     "destination": [
      "dryL_mult",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "dry_line",
      0
     ],
     "destination": [
      "dryR_mult",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "grooveL",
      0
     ],
     "destination": [
      "wetL_mult",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "grooveR",
      0
     ],
     "destination": [
      "wetR_mult",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "wet_line",
      0
     ],
     "destination": [
      "wetL_mult",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "wet_line",
      0
     ],
     "destination": [
      "wetR_mult",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "dryL_mult",
      0
     ],
     "destination": [
      "sumL",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "wetL_mult",
      0
     ],
     "destination": [
      "sumL",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "dryR_mult",
      0
     ],
     "destination": [
      "sumR",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "wetR_mult",
      0
     ],
     "destination": [
      "sumR",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "sumL",
      0
     ],
     "destination": [
      "dac",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "sumR",
      0
     ],
     "destination": [
      "dac",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "pitchSlider",
      0
     ],
     "destination": [
      "pitch_expr",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "pitch_expr",
      0
     ],
     "destination": [
      "store_ratemag",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "store_ratemag",
      0
     ],
     "destination": [
      "rate_mult",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "direction_float",
      0
     ],
     "destination": [
      "rate_mult",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "rate_mult",
      0
     ],
     "destination": [
      "grooveL",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "rate_mult",
      0
     ],
     "destination": [
      "grooveR",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "enterTrail",
      2
     ],
     "destination": [
      "m_dirplus1",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "m_dirplus1",
      0
     ],
     "destination": [
      "direction_float",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "enterTrail",
      1
     ],
     "destination": [
      "store_ratemag",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "enterTrail",
      0
     ],
     "destination": [
      "store_writepos",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "store_writepos",
      0
     ],
     "destination": [
      "trail_sub",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "trail_sub",
      0
     ],
     "destination": [
      "trail_max",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "trail_max",
      0
     ],
     "destination": [
      "grooveL",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "trail_max",
      0
     ],
     "destination": [
      "grooveR",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "rewindToggle",
      0
     ],
     "destination": [
      "rewind_sel",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "rewind_sel",
      0
     ],
     "destination": [
      "enterTrail",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "rewind_sel",
      1
     ],
     "destination": [
      "rewindOn_t",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "rewindOn_t",
      1
     ],
     "destination": [
      "m_dirminus1",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "m_dirminus1",
      0
     ],
     "destination": [
      "direction_float",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "rewindOn_t",
      0
     ],
     "destination": [
      "store_ratemag",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "liveButton",
      0
     ],
     "destination": [
      "enterTrail",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "jumpButton",
      0
     ],
     "destination": [
      "jumpT",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "jumpT",
      1
     ],
     "destination": [
      "jumpSecondsBox",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "jumpSecondsBox",
      0
     ],
     "destination": [
      "jump_ms",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "jump_ms",
      0
     ],
     "destination": [
      "pos_sub",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "jumpT",
      0
     ],
     "destination": [
      "store_writepos",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "store_writepos",
      0
     ],
     "destination": [
      "pos_sub",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "pos_sub",
      0
     ],
     "destination": [
      "wrap_add",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "wrap_add",
      0
     ],
     "destination": [
      "wrap_mod",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "wrap_mod",
      0
     ],
     "destination": [
      "grooveL",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "wrap_mod",
      0
     ],
     "destination": [
      "grooveR",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "loopButton",
      0
     ],
     "destination": [
      "loopState",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "loopState",
      0
     ],
     "destination": [
      "loopState_inc",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "loopState_inc",
      0
     ],
     "destination": [
      "loopState_wrap",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "loopState_wrap",
      0
     ],
     "destination": [
      "loopState",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "loopState",
      0
     ],
     "destination": [
      "sel_loop",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "sel_loop",
      0
     ],
     "destination": [
      "store_readpos",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "store_readpos",
      0
     ],
     "destination": [
      "loopStart_f",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "store_readpos",
      0
     ],
     "destination": [
      "loop_pack",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "sel_loop",
      1
     ],
     "destination": [
      "confirm_t",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "confirm_t",
      1
     ],
     "destination": [
      "store_readpos",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "store_readpos",
      0
     ],
     "destination": [
      "loopEnd_f",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "store_readpos",
      0
     ],
     "destination": [
      "loop_pack",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "loop_pack",
      0
     ],
     "destination": [
      "m_setloop",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "m_setloop",
      0
     ],
     "destination": [
      "grooveL",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "m_setloop",
      0
     ],
     "destination": [
      "grooveR",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "confirm_t",
      0
     ],
     "destination": [
      "m_loopon",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "m_loopon",
      0
     ],
     "destination": [
      "grooveL",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "m_loopon",
      0
     ],
     "destination": [
      "grooveR",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "sel_loop",
      1
     ],
     "destination": [
      "confirmDir_t",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "confirmDir_t",
      1
     ],
     "destination": [
      "m_dirplus1b",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "m_dirplus1b",
      0
     ],
     "destination": [
      "direction_float",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "confirmDir_t",
      0
     ],
     "destination": [
      "store_ratemag",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "sel_loop",
      2
     ],
     "destination": [
      "m_loopoff",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "m_loopoff",
      0
     ],
     "destination": [
      "grooveL",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "m_loopoff",
      0
     ],
     "destination": [
      "grooveR",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "sel_loop",
      2
     ],
     "destination": [
      "enterTrail",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "loopShiftBackBtn",
      0
     ],
     "destination": [
      "shiftBack_t",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "shiftBack_t",
      1
     ],
     "destination": [
      "loopShiftSecondsBox",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "loopShiftSecondsBox",
      0
     ],
     "destination": [
      "shiftBack_ms",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "loopShiftFwdBtn",
      0
     ],
     "destination": [
      "shiftFwd_t",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "shiftFwd_t",
      1
     ],
     "destination": [
      "loopShiftSecondsBox",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "loopShiftSecondsBox",
      0
     ],
     "destination": [
      "shiftFwd_ms",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "shiftBack_ms",
      0
     ],
     "destination": [
      "shiftApply_t",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "shiftFwd_ms",
      0
     ],
     "destination": [
      "shiftApply_t",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "shiftApply_t",
      3
     ],
     "destination": [
      "shiftStart_add",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "shiftApply_t",
      2
     ],
     "destination": [
      "shiftEnd_add",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "shiftApply_t",
      1
     ],
     "destination": [
      "loopStart_f",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "loopStart_f",
      0
     ],
     "destination": [
      "shiftStart_add",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "shiftStart_add",
      0
     ],
     "destination": [
      "shiftStart_wrapA",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "shiftStart_wrapA",
      0
     ],
     "destination": [
      "shiftStart_wrapM",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "shiftStart_wrapM",
      0
     ],
     "destination": [
      "loopStart_f",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "shiftStart_wrapM",
      0
     ],
     "destination": [
      "loop_pack",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "shiftApply_t",
      0
     ],
     "destination": [
      "loopEnd_f",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "loopEnd_f",
      0
     ],
     "destination": [
      "shiftEnd_add",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "shiftEnd_add",
      0
     ],
     "destination": [
      "shiftEnd_wrapA",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "shiftEnd_wrapA",
      0
     ],
     "destination": [
      "shiftEnd_wrapM",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "shiftEnd_wrapM",
      0
     ],
     "destination": [
      "loopEnd_f",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "shiftEnd_wrapM",
      0
     ],
     "destination": [
      "loop_pack",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "loop_pack",
      0
     ],
     "destination": [
      "m_setloop2",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "m_setloop2",
      0
     ],
     "destination": [
      "grooveL",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "m_setloop2",
      0
     ],
     "destination": [
      "grooveR",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "miracleToggle",
      0
     ],
     "destination": [
      "miracle_sel",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "miracleChunkMsBox",
      0
     ],
     "destination": [
      "metro_miracle",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "miracle_sel",
      1
     ],
     "destination": [
      "miracleOn_t",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "miracleOn_t",
      1
     ],
     "destination": [
      "m_loop0_m",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "m_loop0_m",
      0
     ],
     "destination": [
      "grooveL",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "m_loop0_m",
      0
     ],
     "destination": [
      "grooveR",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "miracleOn_t",
      0
     ],
     "destination": [
      "m_metromiracle1",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "m_metromiracle1",
      0
     ],
     "destination": [
      "metro_miracle",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "miracle_sel",
      0
     ],
     "destination": [
      "miracleOff_t",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "miracleOff_t",
      1
     ],
     "destination": [
      "m_metromiracle0",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "m_metromiracle0",
      0
     ],
     "destination": [
      "metro_miracle",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "miracleOff_t",
      0
     ],
     "destination": [
      "enterTrail",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "metro_miracle",
      0
     ],
     "destination": [
      "mTick_t",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "mTick_t",
      3
     ],
     "destination": [
      "random_dir",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "random_dir",
      0
     ],
     "destination": [
      "dir_scale",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "dir_scale",
      0
     ],
     "destination": [
      "dir_offset",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "dir_offset",
      0
     ],
     "destination": [
      "mDir_f",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "mTick_t",
      2
     ],
     "destination": [
      "random_speed",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "random_speed",
      0
     ],
     "destination": [
      "speed_expr",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "mDir_f",
      0
     ],
     "destination": [
      "mRate_mult",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "speed_expr",
      0
     ],
     "destination": [
      "mRate_mult",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "mRate_mult",
      0
     ],
     "destination": [
      "grooveL",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "mRate_mult",
      0
     ],
     "destination": [
      "grooveR",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "min_clip",
      0
     ],
     "destination": [
      "random_age",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "mTick_t",
      1
     ],
     "destination": [
      "random_age",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "random_age",
      0
     ],
     "destination": [
      "pos_sub",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "mTick_t",
      0
     ],
     "destination": [
      "store_writepos",
      0
     ]
    }
   }
  ]
 }
}