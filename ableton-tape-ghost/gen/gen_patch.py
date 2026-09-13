import json

class PatchBuilder:
    def __init__(self, width=1400, height=2600):
        self.boxes = {}   # name -> box dict (without id/patching_rect finalized)
        self.order = []
        self.lines = []   # list of (src_name, out_idx, dst_name, in_idx)
        self.width = width
        self.height = height
        self.col_x = {}   # column -> current y cursor
        self.next_id = 1

    def _id(self):
        s = f"obj-{self.next_id}"
        self.next_id += 1
        return s

    def add(self, name, text=None, cls=None, col=0, w=140, h=22, extra=None, comment_text=None):
        """Add a box. Use text= for newobj/message boxes (auto class 'newobj' or 'message'
        depending on whether text looks like a message, controlled by cls). cls can be
        'newobj','message','comment','flonum','number','toggle','inlet~','outlet~'."""
        if name in self.boxes:
            raise ValueError(f"duplicate box name {name}")
        y = self.col_x.get(col, 40)
        rect = [40 + col * 220, y, w, h]
        self.col_x[col] = y + h + 34
        box = {
            "id": self._id(),
            "col": col,
            "rect": rect,
        }
        if cls is None:
            cls = "newobj"
        box["maxclass"] = cls
        if text is not None:
            box["text"] = text
        if comment_text is not None:
            box["text"] = comment_text
        if extra:
            box.update(extra)
        self.boxes[name] = box
        self.order.append(name)
        return name

    def connect(self, src, out_idx, dst, in_idx):
        self.lines.append((src, out_idx, dst, in_idx))

    def build(self):
        boxes_json = []
        for name in self.order:
            b = self.boxes[name]
            entry = {
                "maxclass": b["maxclass"],
                "id": b["id"],
                "numinlets": b.get("numinlets", 1),
                "numoutlets": b.get("numoutlets", 1),
                "patching_rect": [float(x) for x in b["rect"]],
            }
            if "outlettype" in b:
                entry["outlettype"] = b["outlettype"]
            if b["maxclass"] in ("newobj",):
                entry["text"] = b["text"]
            if b["maxclass"] == "message":
                entry["text"] = b["text"]
            if b["maxclass"] == "comment":
                entry["text"] = b["text"]
                entry["fontsize"] = 12.0
            if b["maxclass"] in ("flonum", "number"):
                pass
            for k, v in b.items():
                if k in ("id", "col", "rect", "maxclass", "numinlets", "numoutlets", "text", "outlettype"):
                    continue
                entry[k] = v
            boxes_json.append({"box": entry})

        lines_json = []
        for (src, out_idx, dst, in_idx) in self.lines:
            if src not in self.boxes:
                raise ValueError(f"unknown src box {src}")
            if dst not in self.boxes:
                raise ValueError(f"unknown dst box {dst}")
            lines_json.append({
                "patchline": {
                    "source": [self.boxes[src]["id"], out_idx],
                    "destination": [self.boxes[dst]["id"], in_idx],
                }
            })

        patcher = {
            "fileversion": 1,
            "appversion": {
                "major": 8, "minor": 6, "revision": 0,
                "architecture": "x64", "modernui": 1
            },
            "classnamespace": "box",
            "rect": [0.0, 0.0, float(self.width), float(self.height)],
            "bglocked": 0,
            "openinpresentation": 1,
            "default_fontsize": 12.0,
            "default_fontface": 0,
            "default_fontname": "Arial",
            "gridonopen": 1,
            "gridsize": [15.0, 15.0],
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
            "boxes": boxes_json,
            "lines": lines_json,
            "parameters": {},
            "dependency_cache": [],
            "autosave": 0
        }
        return {"patcher": patcher}
