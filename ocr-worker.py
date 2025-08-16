# ocr_worker.py
import sys, json, time, re, os
import logging
from typing import Dict, Any, List
from paddleocr import PaddleOCR

# --- Matikan log bising, no file logging ---
os.environ["GLOG_logtostderr"] = "1"
os.environ["FLAGS_logging_level"] = "3"
for name in ("ppocr", "paddle"):
    logging.getLogger(name).setLevel(logging.ERROR)

# --- Init model sekali (DET ch + REC en) ---
# NOTE: sesuaikan path model sesuai letakmu
OCR = PaddleOCR(
    det_model_dir='models/ch_PP-OCRv3_det_infer',
    rec_model_dir='models/en_PP-OCRv3_rec_infer',
    use_angle_cls=False,
    use_space_char=True,
    show_log=False,
    lang="en",
    # drop_score bisa diturunkan agar tidak membuang teks samar
    drop_score=0.2,
    # text_det_box_thresh (default 0.6); bisa disesuaikan
)

DIGIT_MAP = str.maketrans({
    'O':'0','o':'0','Q':'0','D':'0',
    'I':'1','l':'1','|':'1',
    'S':'5','s':'5',
    'B':'8','b':'8',
    'G':'6','g':'6'
})
def normalize_digits(s: str) -> str:
    return re.sub(r'\D', '', (s or '').translate(DIGIT_MAP))

def valid_nik(nik: str) -> bool:
    if not re.fullmatch(r'\d{16}', nik): return False
    dd = int(nik[6:8]); mm = int(nik[8:10]); yy = int(nik[10:12])
    day = dd-40 if dd > 40 else dd
    if not (1 <= day <= 31): return False
    if not (1 <= mm  <= 12): return False
    year = 2000+yy if yy <= 25 else 1900+yy
    return 1950 <= year <= 2025

def extract_nik(ocr_result: List) -> Dict[str, Any]:
    """
    ocr_result = OCR.ocr(image_path)
    Bentuk: [[ [box, (text, conf)], ... ]]
    """
    if not ocr_result or not isinstance(ocr_result, list) or not ocr_result[0]:
        return {"nik": None, "conf": -1, "text": ""}

    words = []
    full_text_parts = []
    for item in ocr_result[0]:
        text = item[1][0] if isinstance(item, list) and len(item) > 1 else ""
        conf = item[1][1] if isinstance(item, list) and len(item) > 1 else 0.0
        if text:
            words.append((text, conf))
            full_text_parts.append(text)

    # 1) Cari dari words ber-confidence (bagus bila NIK utuh sebagai 1 word)
    cand = []
    for w, c in words:
        n = normalize_digits(w)
        if re.fullmatch(r'\d{16}', n) and valid_nik(n):
            cand.append((n, c))
    cand.sort(key=lambda x: x[1], reverse=True)
    if cand:
        return {"nik": cand[0][0], "conf": cand[0][1], "text": " ".join(full_text_parts)}

    # 2) Fallback: cari di full text setelah normalisasi
    full_norm = normalize_digits(" ".join(full_text_parts))
    m = re.search(r'\d{16}', full_norm)
    if m:
        n = m.group(0)
        if valid_nik(n):
            # estimasi conf rata-rata digit words
            digit_words = [c for w,c in words if normalize_digits(w).isdigit()]
            avg_conf = sum(digit_words)/len(digit_words) if digit_words else 0.5
            return {"nik": n, "conf": avg_conf, "text": " ".join(full_text_parts)}

    return {"nik": None, "conf": -1, "text": " ".join(full_text_parts)}

def scan(image_path: str) -> Dict[str, Any]:
    t0 = time.time()
    # NOTE: Kalau kamu sudah preprocess di Node (PNG grayscale/threshold),
    # cukup lempar path tersebut; PaddleOCR bisa handle path atau ndarray.
    ress = OCR.ocr(image_path)
    ext = extract_nik(ress)
    elapsed = time.time() - t0
    if ext["nik"]:
        return {"status": True, "data": {"nik": ext["nik"], "input": image_path}, "confidence": ext["conf"], "text": ext["text"], "execution": f"{elapsed:.3f}s"}
    else:
        return {"status": False, "data": {"message": "NIK not found", "input": image_path}, "text": ext["text"], "execution": f"{elapsed:.3f}s"}

def serve_loop():
    """
    Worker persisten: baca 1 baris JSON → proses → balas 1 baris JSON.
    Format request: {"id": <int>, "image": "<path>"}
    """
    for line in sys.stdin:
        if not line:
            break
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            req_id = req.get("id")
            image = req.get("image")
            resp = scan(image)
            resp["id"] = req_id
            sys.stdout.write(json.dumps(resp, ensure_ascii=False) + "\n")
            sys.stdout.flush()
        except Exception as e:
            sys.stdout.write(json.dumps({"id": req.get("id"), "status": False, "message": str(e)}) + "\n")
            sys.stdout.flush()

if __name__ == "__main__":
    # Jalankan sebagai worker persisten (disarankan)
    serve_loop()
