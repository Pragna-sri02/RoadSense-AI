import base64
import io
import logging
from typing import Any, Dict, List, Optional, Tuple
import cv2
import numpy as np
from PIL import ExifTags, Image

logger = logging.getLogger(__name__)


def _convert_to_degrees(value) -> float:
    """Helper function to convert the GPS coordinates stored in the EXIF to degrees in float format."""
    try:
        d = float(value[0])
        m = float(value[1])
        s = float(value[2])
        return d + (m / 60.0) + (s / 3600.0)
    except Exception:
        return 0.0


def extract_exif_gps(image_bytes: bytes) -> Optional[Tuple[float, float]]:
    """Extract latitude and longitude from image EXIF metadata if present."""
    try:
        pil_img = Image.open(io.BytesIO(image_bytes))
        exif = pil_img.getexif()
        if not exif:
            return None

        # Look for GPSInfo tag (0x8825 = 34853)
        gps_info = None
        for tag_id, value in exif.items():
            tag_name = ExifTags.TAGS.get(tag_id, tag_id)
            if tag_name == "GPSInfo" or tag_id == 34853:
                gps_info = value
                break

        if not gps_info:
            return None

        # Parse GPS tags
        lat_val = gps_info.get(2)
        lat_ref = gps_info.get(1)
        lon_val = gps_info.get(4)
        lon_ref = gps_info.get(3)

        if lat_val and lat_ref and lon_val and lon_ref:
            lat = _convert_to_degrees(lat_val)
            if lat_ref != "N":
                lat = -lat

            lon = _convert_to_degrees(lon_val)
            if lon_ref != "E":
                lon = -lon

            if -90 <= lat <= 90 and -180 <= lon <= 180:
                return round(lat, 6), round(lon, 6)
    except Exception as exc:
        logger.debug(f"EXIF GPS extraction skipped: {exc}")

    return None


def detect_road_hazards_cv(image_bytes: bytes) -> Dict[str, Any]:
    """
    Computer Vision pipeline for detecting potholes and road surface damage.
    Uses contour topology, asphalt cavity segmentation, and edge density gradients.
    Draws detection boxes and returns an annotated image with confidence metrics.
    """
    # 1. Decode image from bytes
    nparr = np.frombuffer(image_bytes, np.uint8)
    img_bgr = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img_bgr is None:
        raise ValueError("Could not decode image. Please upload a valid JPEG, PNG, or WebP image.")

    orig_h, orig_w = img_bgr.shape[:2]

    # Normalize processing resolution to standard 720p scale while keeping aspect ratio
    target_w = 720
    scale = target_w / float(orig_w)
    target_h = int(orig_h * scale)
    resized = cv2.resize(img_bgr, (target_w, target_h), interpolation=cv2.INTER_AREA)

    # 2. Extract EXIF GPS if available
    gps_coords = extract_exif_gps(image_bytes)

    # 3. Focus on Road Region of Interest (ROI) - suppress sky/horizon in upper 20%
    roi_top = int(target_h * 0.15)
    roi = resized[roi_top:target_h, 0:target_w]

    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)

    # Apply Contrast Limited Adaptive Histogram Equalization (CLAHE) to reveal asphalt cavities
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
    enhanced = clahe.apply(gray)

    # Blur to filter high-frequency gravel noise while preserving cavity contours
    blurred = cv2.GaussianBlur(enhanced, (9, 9), 0)

    # Calculate global road background luminance in the ROI
    road_median = float(np.median(gray))

    # Threshold for dark cavities (potholes typically have a luminance drop relative to road plane)
    cavity_thresh = max(25, int(road_median * 0.62))
    _, dark_mask = cv2.threshold(blurred, cavity_thresh, 255, cv2.THRESH_BINARY_INV)

    # Morphological closing to join fragmented pothole depression areas
    kernel_close = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11))
    closed = cv2.morphologyEx(dark_mask, cv2.MORPH_CLOSE, kernel_close)

    # Multi-scale Canny edge detection for structural fracture boundaries
    edges = cv2.Canny(blurred, 40, 120)
    kernel_dilate = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    edges_dilated = cv2.dilate(edges, kernel_dilate, iterations=1)

    # Combine dark depression with edge fractures
    combined = cv2.bitwise_and(closed, closed, mask=cv2.bitwise_or(closed, edges_dilated))

    # Find candidate contours
    contours, _ = cv2.findContours(combined, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    detections = []
    annotated = resized.copy()

    min_area = (target_w * target_h) * 0.0035  # ~0.35% of frame
    max_area = (target_w * target_h) * 0.45    # avoid whole-frame artifacts

    for cnt in contours:
        area = cv2.contourArea(cnt)
        if area < min_area or area > max_area:
            continue

        x, y, w, h = cv2.boundingRect(cnt)
        aspect_ratio = float(w) / float(h)
        if aspect_ratio < 0.25 or aspect_ratio > 4.0:
            continue

        # Compute internal cavity mean luminance vs surrounding border rim
        actual_y = y + roi_top
        cavity_roi = gray[y : y + h, x : x + w]
        cavity_mean = float(np.mean(cavity_roi))
        contrast_drop = max(0.0, road_median - cavity_mean)

        # Edge gradient score inside the bounding contour
        edge_roi = edges[y : y + h, x : x + w]
        edge_density = float(np.count_nonzero(edge_roi)) / float(w * h)

        # Calculate confidence metric
        contrast_score = min(1.0, contrast_drop / 45.0)
        area_score = min(1.0, area / 15000.0)
        solidity = float(area) / float(w * h)

        confidence = 0.60 + (contrast_score * 0.20) + (edge_density * 8.0 * 0.10) + (min(1.0, solidity * 1.2) * 0.08)
        confidence = round(float(np.clip(confidence, 0.65, 0.94)), 2)

        # Determine severity and hazard label
        if area > 12000 or contrast_drop > 35:
            severity = "High"
            hazard_label = "Pothole"
        elif area > 5000:
            severity = "Moderate"
            hazard_label = "Pothole"
        else:
            severity = "Moderate"
            hazard_label = "Damaged Road Surface" if aspect_ratio > 1.8 else "Pothole"

        # Scale coordinates back to original image coordinates
        scale_x = float(orig_w) / float(target_w)
        scale_y = float(orig_h) / float(target_h)
        orig_box = [
            int(x * scale_x),
            int(actual_y * scale_y),
            int(w * scale_x),
            int(h * scale_y),
        ]

        detections.append(
            {
                "box": orig_box,
                "confidence": confidence,
                "label": hazard_label,
                "severity": severity,
            }
        )

        # Draw nice annotation on resized display image
        box_color = (34, 45, 239) if severity == "High" else (16, 149, 234)  # BGR
        cv2.rectangle(annotated, (x, actual_y), (x + w, actual_y + h), box_color, 2)

        label_text = f"{hazard_label.upper()} ({int(confidence * 100)}%)"
        (text_w, text_h), baseline = cv2.getTextSize(label_text, cv2.FONT_HERSHEY_SIMPLEX, 0.45, 1)
        tag_y1 = max(0, actual_y - text_h - 8)
        cv2.rectangle(
            annotated,
            (x, tag_y1),
            (x + text_w + 10, actual_y),
            box_color,
            -1,
        )
        cv2.putText(
            annotated,
            label_text,
            (x + 5, actual_y - 4),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.45,
            (255, 255, 255),
            1,
            cv2.LINE_AA,
        )

    # If no large cavities found, check for surface cracking / asphalt fracture patterns
    if not detections:
        laplacian_var = float(cv2.Laplacian(gray, cv2.CV_64F).var())
        if laplacian_var > 380:
            # Pervasive cracking detected across road section
            confidence = round(min(0.85, 0.65 + (laplacian_var / 2000.0)), 2)
            has_damage = True
            primary_hazard = "Cracked Road"
            severity = "Moderate"
            suggested_desc = (
                f"Computer vision analysis identified pervasive asphalt surface cracking "
                f"(texture variance: {int(laplacian_var)}, confidence: {int(confidence * 100)}%)."
            )
        else:
            has_damage = False
            primary_hazard = "Normal Road Surface"
            confidence = 0.90
            severity = "None"
            suggested_desc = "Computer vision analysis indicates acceptable road pavement condition with no deep potholes or severe fractures."
    else:
        has_damage = True
        detections.sort(key=lambda d: d["confidence"], reverse=True)
        primary_hazard = detections[0]["label"]
        confidence = detections[0]["confidence"]
        severity = detections[0]["severity"]
        count = len(detections)
        suggested_desc = (
            f"Computer vision detected {count} road defect(s) ({primary_hazard}) "
            f"with {int(confidence * 100)}% confidence ({severity} severity)."
        )

    # Encode annotated image to Base64 JPEG
    _, enc_buf = cv2.imencode(".jpg", annotated, [cv2.IMWRITE_JPEG_QUALITY, 85])
    b64_str = base64.b64encode(enc_buf).decode("utf-8")
    annotated_image_url = f"data:image/jpeg;base64,{b64_str}"

    extracted_gps_dict = None
    if gps_coords:
        extracted_gps_dict = {
            "latitude": gps_coords[0],
            "longitude": gps_coords[1],
        }

    return {
        "has_damage": has_damage,
        "hazard_type": primary_hazard,
        "confidence": confidence,
        "severity": severity,
        "detections": detections,
        "extracted_gps": extracted_gps_dict,
        "suggested_location": f"GPS Photo Coordinates ({gps_coords[0]}, {gps_coords[1]})" if gps_coords else None,
        "suggested_description": suggested_desc,
        "annotated_image": annotated_image_url,
        "analysis_method": "Computer Vision Surface Analyzer (OpenCV Contour & Cavity Extraction)",
    }
