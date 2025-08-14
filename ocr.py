import logging
import re
from paddleocr import PaddleOCR
import json
import sys
import time
import traceback
import cv2
import os

# # Disable PaddleOCR logs
sys.stdout = open(sys.stdout.fileno(), mode='w', buffering=1, encoding='utf-8', errors='ignore')
sys.stderr = sys.stdout  # optional, biar stderr & stdout sama
os.environ["FLAGS_log_dir"] = "/dev/null"  # Matikan log file
os.environ["GLOG_logtostderr"] = "1"
os.environ["FLAGS_logging_level"] = "3"
logging.getLogger("ppocr").setLevel(logging.ERROR)
logging.getLogger("paddle").setLevel(logging.ERROR)

ocr = PaddleOCR(
    use_angle_cls=False,
    use_space_char=True,
    show_log=False,
    use_textline_orientation=False, 
    text_det_box_thresh=0.8,
    text_recognition_batch_size=4,
    lang="en"
)

def resize_image_if_needed(image_path, max_width=1024):
    try:
        img = cv2.imread(image_path)
        if img is None:
            return image_path  # fallback
        h, w = img.shape[:2]
        if w > max_width:
            ratio = max_width / w
            resized_img = cv2.resize(img, (int(w * ratio), int(h * ratio)))
            tmp_path = "/tmp/resized.jpg"
            cv2.imwrite(tmp_path, resized_img)
            return tmp_path
        return image_path
    except Exception as e:
        return image_path  # fallback

def exec_scan(path, start_time):
    # Run OCR on image
    try:
        path = resize_image_if_needed(path)
        ress = ocr.ocr(path)
        ocr_time = time.time()
        # full_text = " ".join([line[1][0] for line in ress[0]])
        if ress and ress[0]:  # Ensure ress is not empty and ress[0] is not None
            full_text = " ".join([line[1][0] for line in ress[0]])

            match = re.search(r"\b\d{16}\b", full_text)
            end_time = time.time()
            # Print the extracted NIK
            if match:
                nik = match.group(0)
                response = {
                    "status": True,
                    "data": {
                        "nik": nik,
                        "input": path
                    },
                    "execution": f"Total Execution Time: {end_time - start_time:.2f} seconds"
                }
                print(json.dumps(response))
                # print("NIK:", nik)
                sys.stdout.flush()
                sys.exit(0)
            else:
                response = {
                    "status": False,
                    "data": {
                        "message": "NIK not found",
                        "input": path
                    },
                    "execution": f"Total Execution Time: {end_time - start_time:.2f} seconds"
                }
                print(json.dumps(response))
                sys.stdout.flush()
                sys.exit(0)
                # print("NIK not found")
        else:
            end_time = time.time()
            response = {
                "status": False,
                "data": {
                    "message": "failed scanning data",
                    "input": path
                },
                "execution": f"Total Execution Time: {end_time - start_time:.2f} seconds"
            }
            print(json.dumps(response))
            full_text = ""  # Set a default value to avoid crashes
            sys.stdout.flush()
            sys.exit(0)
    except Exception as e:
        response = {
                "status": False,
                "message": str(e),
            }
        
        print(json.dumps(response))
        
        sys.stdout.flush()
        sys.exit(1)

if __name__ == "__main__":
    try:
        start_time = time.time()
        input_data = sys.stdin.read().strip()
        data = json.loads(input_data)
        image_path = data.get("image", "-")
        exec_scan(image_path, start_time)
    except Exception as e:
        response = {
            "status": False,
            "message": str(e),
            "trace": traceback.format_exc()
        }
        print(json.dumps(response))
        sys.stdout.flush()
        sys.exit(1)
# exec_scan(image_path)