#!/bin/sh
# Downloads the MediaPipe runtime, the two models and mediabunny into assets/ (not committed).
# They are published next to the artifact page, which cannot fetch from other hosts.
# The standalone index.html does not need them: it loads the same files from jsDelivr and Google.
set -e
cd "$(dirname "$0")/.."
MP=0.10.35 MB=1.65.0
T=$(mktemp -d)
mkdir -p assets/mediapipe assets/models
(cd "$T" && npm pack --silent "@mediapipe/tasks-vision@$MP" "mediabunny@$MB" >/dev/null && for f in *.tgz; do mkdir "${f%.tgz}" && tar xzf "$f" -C "${f%.tgz}"; done)
cp "$T/mediapipe-tasks-vision-$MP/package/vision_bundle.mjs" "$T/mediapipe-tasks-vision-$MP/package/wasm/vision_wasm_internal.js" "$T/mediapipe-tasks-vision-$MP/package/wasm/vision_wasm_internal.wasm" assets/mediapipe/
cp "$T/mediabunny-$MB/package/dist/bundles/mediabunny.min.mjs" assets/
G=https://storage.googleapis.com/mediapipe-models
curl -fsSL -o assets/models/pose_landmarker_full.task "$G/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task"
curl -fsSL -o assets/models/face_landmarker.task "$G/face_landmarker/face_landmarker/float16/1/face_landmarker.task"
curl -fsSL -o assets/models/efficientdet_lite2.tflite "$G/object_detector/efficientdet_lite2/int8/1/efficientdet_lite2.tflite"
curl -fsSL -o assets/models/deeplab_v3.tflite "$G/image_segmenter/deeplab_v3/float32/1/deeplab_v3.tflite"
# artifacts serve no binary model type, so the models also go next to the page as base64 text
for f in assets/models/*.task assets/models/*.tflite; do base64 -w 0 "$f" > "$f.b64.txt"; done
rm -rf "$T"
ls -l assets assets/mediapipe assets/models
