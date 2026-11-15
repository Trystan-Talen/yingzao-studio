"""Offline, versioned linear-light matting. No model downloads or case-specific rules."""
import contextlib
import ctypes
import importlib
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import re
import sys

PROTOCOL = "yingzao-local-matting-v2"
VERSIONS = {"python": "3.12.13", "pymatting": "1.1.16", "numpy": "2.5.4",
            "scipy": "1.18.1", "numba": "0.68.1", "llvmlite": "0.50.0", "Pillow": "13.0.0"}
MAX_PIXELS = 6_000_000


@contextlib.contextmanager
def diagnostics_to_stderr():
    """Keep both Python and native-library diagnostics out of the JSON channel."""
    sys.stdout.flush()
    saved = os.dup(1)
    try:
        os.dup2(2, 1)
        with contextlib.redirect_stdout(sys.stderr):
            yield
    finally:
        sys.stderr.flush()
        # C stdio may buffer a native warning until process exit. Drain it while
        # descriptor 1 still points at stderr, before restoring the JSON channel.
        ctypes.CDLL(None).fflush(None)
        os.dup2(saved, 1)
        os.close(saved)


def versions():
    actual = {name: platform.python_version() if name == "python" else importlib.metadata.version(name)
              for name in VERSIONS}
    if actual != VERSIONS:
        raise ValueError("RUNTIME_VERSION_MISMATCH")
    return actual


def absolute_path(request, name):
    value = request.get(name)
    if not isinstance(value, str) or not value or not os.path.isabs(value):
        raise ValueError("PATH_INVALID")
    return Path(value)


def solve(request):
    # These thread counts and all numerical parameters match frozen linear v6.
    os.environ["NUMBA_NUM_THREADS"] = "2"
    os.environ["OPENBLAS_NUM_THREADS"] = "2"
    import numpy as np
    from PIL import Image
    from scipy.ndimage import gaussian_filter, distance_transform_edt, label, maximum, gaussian_gradient_magnitude, watershed_ift
    from pymatting import estimate_alpha_cf, estimate_foreground_ml

    width, height = request.get("width"), request.get("height")
    if (type(width) is not int or type(height) is not int or not 64 <= width <= 4096
            or not 64 <= height <= 4096 or width * height > MAX_PIXELS):
        raise ValueError("SIZE_INVALID")
    color = request.get("color")
    if not isinstance(color, str) or re.fullmatch(r"#[0-9a-fA-F]{6}", color) is None:
        raise ValueError("COLOR_INVALID")
    scene_boundary = request.get("sceneBoundary")
    if "sceneBoundary" in request and scene_boundary != "continuous-soft-exterior-v1":
        raise ValueError("SCENE_BOUNDARY_INVALID")
    source_path, raw_path, seed_path, mask_path, composite_path = (
        absolute_path(request, name) for name in
        ("sourcePath", "rawMaskPath", "seedPath", "maskOutputPath", "compositeOutputPath"))
    paths = [p.resolve() for p in (source_path, raw_path, seed_path, mask_path, composite_path)]
    if len(set(paths)) != len(paths):
        raise ValueError("PATH_COLLISION")
    if seed_path.stat().st_size != width * height * 4:
        raise ValueError("SEED_SIZE_INVALID")

    def pixels(path, mode):
        if path.stat().st_size > 128 * 1024 ** 2:
            raise ValueError("INPUT_TOO_LARGE")
        with Image.open(path) as im:
            if im.size != (width, height) or getattr(im, "n_frames", 1) != 1:
                raise ValueError("INPUT_DIMENSIONS_INVALID")
            if im.getexif().get(274, 1) != 1:
                raise ValueError("INPUT_ORIENTATION_NOT_CANONICAL")
            return np.asarray(im.convert(mode))

    original = pixels(source_path, "RGB")
    raw = pixels(raw_path, "L")
    subject = np.fromfile(seed_path, dtype="<f4").reshape(height, width)
    if not np.isfinite(subject).all() or np.any(subject < 0) or np.any(subject > 1):
        raise ValueError("SEED_VALUES_INVALID")

    def srgb_decode(x):
        return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)

    def srgb_encode(x):
        x = np.clip(x, 0.0, 1.0)
        return np.where(x <= 0.0031308, x * 12.92, 1.055 * x ** (1.0 / 2.4) - 0.055)

    image = srgb_decode(original.astype(np.float64) / 255)
    raw_foreground = raw < 128
    if scene_boundary is not None:
        # Server-frozen visual evidence must establish one exterior background,
        # no interior background holes, and a protected soft scene silhouette.
        # The default path deliberately retains all original semantic regions.
        raw_background = raw >= 128
        band = max(3, round(min(width, height) / 128))
        core = distance_transform_edt(raw_background) > band
        parts, count = label(core)
        if count == 0:
            raise ValueError("EXTERIOR_BACKGROUND_CORE_MISSING")
        sizes = np.bincount(parts.ravel())
        sizes[0] = 0
        main_background = parts == int(sizes.argmax())
        reconstructed = raw_background & (distance_transform_edt(~main_background) <= band)
        raw_foreground = ~reconstructed
    radius = max(16, round(min(width, height) / 32))
    near_object = distance_transform_edt(subject < .5) < radius
    known_foreground = ((distance_transform_edt(raw_foreground) > radius) & (~near_object)) | (
        distance_transform_edt(subject >= .5) > 2 * int(np.ceil(max(width, height) / 1024)))
    background_candidate = (~raw_foreground) & (subject < .5)
    component, component_count = label(background_candidate)
    bg_distance = distance_transform_edt(background_candidate)
    peaks = maximum(bg_distance, component, np.arange(component_count + 1))
    threshold = np.maximum(3, np.minimum(radius, peaks / 2))
    known_background = background_candidate & (bg_distance > threshold[component])
    known_background |= near_object & (subject < .01) & (bg_distance > 3)
    known_foreground &= ~known_background
    if not known_foreground.any() or not known_background.any():
        raise ValueError("TRIMAP_SEEDS_MISSING")

    # Only strengthen existing semantic foreground. Never expand background seeds.
    gradient = np.max(np.stack([gaussian_gradient_magnitude(image[:, :, c], 1) for c in range(3)]), axis=0)
    gradient = np.uint8(np.rint(np.clip(gradient / max(float(np.max(gradient)), 1e-8), 0, 1) * 255))
    markers = np.zeros((height, width), np.int32)
    markers[known_foreground] = 1
    markers[known_background] = 2
    scene = watershed_ift(gradient, markers) == 1
    scene_band = max(4, round(min(width, height) / 128))
    known_foreground |= raw_foreground & (subject < .01) & (distance_transform_edt(scene) > scene_band)
    trimap = np.full((height, width), .5)
    trimap[known_foreground] = 1
    trimap[known_background] = 0
    alpha = estimate_alpha_cf(image, trimap, laplacian_kwargs={"epsilon": 1e-7},
                              cg_kwargs={"maxiter": 1000, "rtol": 1e-6})
    if not np.isfinite(alpha).all():
        raise ValueError("ALPHA_NONFINITE")
    alpha = np.rint(np.clip(alpha, 0, 1) * 255) / 255
    alpha[known_foreground] = 1
    alpha[known_background] = 0
    if scene_boundary is not None:
        # This optional geometry feather is not a measured optical opacity.
        # Smoothly join it to object matting without changing the default v6.
        scene_alpha = gaussian_filter(raw_foreground.astype(np.float64), sigma=scene_band / 3)
        weight = np.clip((distance_transform_edt(subject < .5) - 2) / scene_band, 0, 1)
        alpha = np.rint(np.clip(alpha * (1 - weight) + scene_alpha * weight, 0, 1) * 255) / 255
    foreground = estimate_foreground_ml(image, alpha)
    if not np.isfinite(foreground).all():
        raise ValueError("FOREGROUND_NONFINITE")
    target_encoded = np.array([int(color[i:i + 2], 16) / 255 for i in (1, 3, 5)])
    target = srgb_decode(target_encoded)
    result = np.uint8(np.rint(srgb_encode(
        foreground * alpha[:, :, None] + target * (1 - alpha[:, :, None])) * 255))
    result[alpha == 1] = original[alpha == 1]
    result[alpha == 0] = np.uint8(np.rint(target_encoded * 255))
    mask = 255 - np.uint8(np.rint(alpha * 255))
    with mask_path.open("xb") as output:
        Image.fromarray(mask).save(output, format="PNG")
    with composite_path.open("xb") as output:
        Image.fromarray(result).save(output, format="PNG")
    response = {"protocol": PROTOCOL, "stage": "matte", "width": width, "height": height,
                "algorithm": "lite-linear-cf-ml-v6", "workingColorSpace": "linear-srgb"}
    if scene_boundary is not None:
        response["sceneBoundary"] = scene_boundary
    return response


def main():
    payload = sys.stdin.buffer.read(32769)
    if len(payload) > 32768:
        raise ValueError("REQUEST_TOO_LARGE")
    request = json.loads(payload)
    if not isinstance(request, dict) or request.get("protocol") != PROTOCOL:
        raise ValueError("PROTOCOL_INVALID")
    with diagnostics_to_stderr():
        actual_versions = versions()
        if request.get("operation") == "health":
            # Metadata alone cannot detect a missing native extension or incompatible ABI.
            for module in ("numpy", "scipy.ndimage", "numba", "llvmlite", "PIL.Image", "pymatting"):
                importlib.import_module(module)
            response = {"protocol": PROTOCOL, "stage": "health", "versions": actual_versions}
        elif request.get("operation") == "matte":
            response = solve(request)
        else:
            raise ValueError("OPERATION_INVALID")
    print(json.dumps(response, allow_nan=False), flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("LOCAL_MATTING_HELPER_FAILED", file=sys.stderr, flush=True)
        sys.exit(1)
