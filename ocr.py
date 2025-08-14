import logging
import re
from paddleocr import PaddleOCR
import json
import sys
import time
import traceback

# # Disable PaddleOCR logs
logging.getLogger("ppocr").setLevel(logging.ERROR)
# start_time = time.time()
# # Read JSON from stdin
# input_data = sys.stdin.read().strip()
# data = json.loads(input_data)
# # Path to the image of KTP
# # image_path = "/Users/admin/Downloads/ktpAndre.jpeg"
# image_path = data.get("image", "-")
ocr = PaddleOCR(
    use_angle_cls=False,
    use_space_char=True,
    show_log=False,
    use_textline_orientation=False, 
    text_det_box_thresh=0.8,
    text_recognition_batch_size=4,
    lang="en"
)

def exec_scan(path):
    # Run OCR on image
    try:
        # ocr = PaddleOCR(
        #     use_textline_orientation=False,  # Disable angle detection (faster)
        #     text_det_box_thresh=0.8,  # Adjust detection threshold
        #     text_recognition_batch_size=4,  # Reduce batch size
        #     lang="en"
        # )
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
        exec_scan(image_path)
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