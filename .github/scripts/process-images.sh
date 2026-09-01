#!/usr/bin/env bash

set -euo pipefail

CONTENT_DIR="./content/posts"
CACHE_DIR=".cache/images"
FONT="./static/ArchitectsDaughter-Regular.ttf"

# ============================================================
# 图片处理参数
# ============================================================

MAX_WIDTH=1080

# 响应式候选尺寸
RESPONSIVE_WIDTHS=(320 480 720 1080)

# JPG/JPEG fallback
JPEG_QUALITY=82

# WebP
WEBP_PHOTO_QUALITY=75
WEBP_PICTURE_QUALITY=80

# AVIF
AVIF_PHOTO_QUALITY=50
AVIF_PICTURE_QUALITY=55

# Watermark
WATERMARK_TEXT=$'@liudon\nhttps://liudon.com'
WATERMARK_COLOR="#909090"
WATERMARK_POINTSIZE=48
WATERMARK_OFFSET="+0+20"

mkdir -p "$CACHE_DIR"

# ============================================================
# Preconditions
# ============================================================

if [[ ! -d "$CONTENT_DIR" ]]; then
    echo "ERROR: content directory not found: $CONTENT_DIR"
    exit 1
fi

if [[ ! -f "$FONT" ]]; then
    echo "ERROR: watermark font not found: $FONT"
    exit 1
fi

if ! command -v magick >/dev/null 2>&1; then
    echo "ERROR: ImageMagick is not installed"
    exit 1
fi

if ! magick -list format | grep -qE '^[[:space:]]*AVIF[[:space:]]+rw'; then
    echo "ERROR: ImageMagick does not support AVIF encoding"
    magick -list format | grep -Ei 'AVIF|HEIC' || true
    exit 1
fi

# ============================================================
# Cache identity
# ============================================================

SCRIPT_HASH="$(
    sha256sum "$0" |
    awk '{print $1}'
)"

FONT_HASH="$(
    sha256sum "$FONT" |
    awk '{print $1}'
)"

processed=0
cached=0
failed=0

used_hashes="$(mktemp)"

cleanup() {
    rm -f "$used_hashes"
}

trap cleanup EXIT

# ============================================================
# Validation
# ============================================================

validate_image() {
    local file_path="$1"

    [[ -s "$file_path" ]] || return 1

    magick identify "$file_path" >/dev/null 2>&1
}

validate_format() {
    local file_path="$1"
    local expected="$2"

    [[ -s "$file_path" ]] || return 1

    local format

    format="$(
        magick identify \
            -format '%m' \
            "$file_path" \
            2>/dev/null || true
    )"

    [[ "$format" == "$expected" ]]
}

# ============================================================
# Restore cached outputs
# ============================================================

restore_outputs() {
    local src="$1"
    local base="$2"
    local manifest="$3"
    local cache_dir="$4"

    cp "$base" "$src"

    while IFS= read -r width; do

        [[ -n "$width" ]] || continue

        cp \
            "$cache_dir/${width}.webp" \
            "${src}_${width}x.webp"

        cp \
            "$cache_dir/${width}.avif" \
            "${src}_${width}x.avif"

    done < "$manifest"
}

# ============================================================
# Process one image
# ============================================================

process_image() {
    local src="$1"

    local ext="${src##*.}"
    local ext_lower="${ext,,}"

    local image_type
    local webp_quality
    local avif_quality

    case "$ext_lower" in

        jpg|jpeg)
            image_type="photo"
            webp_quality="$WEBP_PHOTO_QUALITY"
            avif_quality="$AVIF_PHOTO_QUALITY"
            ;;

        png)
            image_type="picture"
            webp_quality="$WEBP_PICTURE_QUALITY"
            avif_quality="$AVIF_PICTURE_QUALITY"
            ;;

        *)
            return 0
            ;;

    esac

    # --------------------------------------------------------
    # Source hash
    # --------------------------------------------------------

    local source_hash

    source_hash="$(
        sha256sum "$src" |
        awk '{print $1}'
    )"

    # --------------------------------------------------------
    # Config
    # --------------------------------------------------------

    local config

    config="\
max_width=${MAX_WIDTH};\
responsive_widths=${RESPONSIVE_WIDTHS[*]};\
image_type=${image_type};\
jpeg_quality=${JPEG_QUALITY};\
webp_quality=${webp_quality};\
avif_quality=${avif_quality};\
watermark_text=${WATERMARK_TEXT};\
watermark_color=${WATERMARK_COLOR};\
watermark_pointsize=${WATERMARK_POINTSIZE};\
watermark_offset=${WATERMARK_OFFSET};\
font_hash=${FONT_HASH};\
script_hash=${SCRIPT_HASH}"

    # --------------------------------------------------------
    # Cache hash
    # --------------------------------------------------------

    local hash

    hash="$(
        {
            printf '%s\n' "$source_hash"
            printf '%s\n' "$config"
        } |
        sha256sum |
        awk '{print $1}'
    )"

    printf '%s\n' "$hash" >> "$used_hashes"

    local cache_dir="$CACHE_DIR/$hash"

    local base="$cache_dir/source.$ext_lower"

    local manifest="$cache_dir/widths.txt"

    # --------------------------------------------------------
    # Check cache
    # --------------------------------------------------------

    local cache_ok=1

    if \
        ! validate_image "$base" ||
        [[ ! -s "$manifest" ]]
    then
        cache_ok=0
    fi

    if (( cache_ok )); then

        while IFS= read -r width; do

            [[ -n "$width" ]] || continue

            if \
                ! validate_format "$cache_dir/${width}.webp" "WEBP" ||
                ! validate_format "$cache_dir/${width}.avif" "AVIF"
            then
                cache_ok=0
                break
            fi

        done < "$manifest"

    fi

    # --------------------------------------------------------
    # Cache hit
    # --------------------------------------------------------

    if (( cache_ok )); then

        echo "CACHE   $src"

        restore_outputs \
            "$src" \
            "$base" \
            "$manifest" \
            "$cache_dir"

        cached=$((cached + 1))

        return 0

    fi

    # --------------------------------------------------------
    # Cache miss
    # --------------------------------------------------------

    echo
    echo "PROCESS $src"

    rm -rf "$cache_dir"

    mkdir -p "$cache_dir"

    # --------------------------------------------------------
    # Generate fallback/base image
    #
    # 原始处理顺序：
    #
    # source
    #   ↓
    # auto orient
    #   ↓
    # max 1080
    #   ↓
    # watermark
    #
    # 然后所有 AVIF/WebP 都从这个 base 继续缩放。
    #
    # 这样水印只绘制一次。
    # --------------------------------------------------------

    if [[ "$ext_lower" == "png" ]]; then

        magick "$src" \
            -auto-orient \
            -resize "${MAX_WIDTH}x>" \
            -pointsize "$WATERMARK_POINTSIZE" \
            -fill "$WATERMARK_COLOR" \
            -font "$FONT" \
            -gravity south \
            -annotate "$WATERMARK_OFFSET" "$WATERMARK_TEXT" \
            -define png:compression-level=9 \
            "$base"

    else

        magick "$src" \
            -auto-orient \
            -resize "${MAX_WIDTH}x>" \
            -pointsize "$WATERMARK_POINTSIZE" \
            -fill "$WATERMARK_COLOR" \
            -font "$FONT" \
            -gravity south \
            -annotate "$WATERMARK_OFFSET" "$WATERMARK_TEXT" \
            -quality "$JPEG_QUALITY" \
            "$base"

    fi

    if ! validate_image "$base"; then

        echo "ERROR: failed to generate base image"
        echo "$src"

        failed=$((failed + 1))

        return 1
    fi

    # --------------------------------------------------------
    # Actual base width
    # --------------------------------------------------------

    local base_width
    local base_height

    base_width="$(
        magick identify \
            -format '%w' \
            "$base"
    )"

    base_height="$(
        magick identify \
            -format '%h' \
            "$base"
    )"

    # --------------------------------------------------------
    # Build responsive width list
    #
    # 例：
    #
    # 1080 → 320 480 720 1080
    # 900  → 320 480 720 900
    # 600  → 320 480 600
    # 250  → 250
    #
    # 绝不放大图片。
    # --------------------------------------------------------

    {
        for width in "${RESPONSIVE_WIDTHS[@]}"; do

            if (( width <= base_width )); then
                echo "$width"
            fi

        done

        # 始终加入原图最终宽度
        echo "$base_width"

    } |
        sort -n -u \
        > "$manifest"

    # --------------------------------------------------------
    # Generate WebP + AVIF
    # --------------------------------------------------------

    while IFS= read -r width; do

        [[ -n "$width" ]] || continue

        local webp="$cache_dir/${width}.webp"
        local avif="$cache_dir/${width}.avif"

        echo "        generate ${width}w"

        # ------------------------------
        # WebP
        # ------------------------------

        rm -f "$webp"

        magick "$base" \
            -resize "${width}x>" \
            -quality "$webp_quality" \
            -define webp:image-hint="$image_type" \
            -define webp:method=6 \
            "$webp"

        if ! validate_format "$webp" "WEBP"; then

            echo "ERROR: WebP encoding failed"
            echo "Source: $src"
            echo "Width : $width"

            failed=$((failed + 1))

            return 1
        fi

        # ------------------------------
        # AVIF
        # ------------------------------

        rm -f "$avif"

        magick "$base" \
            -resize "${width}x>" \
            -quality "$avif_quality" \
            "$avif"

        if ! validate_format "$avif" "AVIF"; then

            echo "ERROR: AVIF encoding failed"
            echo "Source: $src"
            echo "Width : $width"

            failed=$((failed + 1))

            return 1
        fi

    done < "$manifest"

    # --------------------------------------------------------
    # Restore generated outputs into Hugo content
    # --------------------------------------------------------

    restore_outputs \
        "$src" \
        "$base" \
        "$manifest" \
        "$cache_dir"

    # --------------------------------------------------------
    # Statistics
    # --------------------------------------------------------

    echo
    echo "        base     : ${base_width}x${base_height}"
    echo "        variants : $(paste -sd ',' "$manifest")"

    local largest_width

    largest_width="$(
        tail -n 1 "$manifest"
    )"

    local base_size
    local webp_size
    local avif_size

    base_size="$(
        du -h "$base" |
        cut -f1
    )"

    webp_size="$(
        du -h "$cache_dir/${largest_width}.webp" |
        cut -f1
    )"

    avif_size="$(
        du -h "$cache_dir/${largest_width}.avif" |
        cut -f1
    )"

    echo "        base     : $base_size"
    echo "        webp max : $webp_size (q=$webp_quality)"
    echo "        avif max : $avif_size (q=$avif_quality)"

    processed=$((processed + 1))

    return 0
}

# ============================================================
# Process all source images
# ============================================================

while IFS= read -r -d '' image; do

    process_image "$image"

done < <(
    find "$CONTENT_DIR" \
        -type f \
        \( \
            -iname "*.jpg" \
            -o -iname "*.jpeg" \
            -o -iname "*.png" \
        \) \
        -print0
)

# ============================================================
# Prune unused cache
# ============================================================

if [[ -s "$used_hashes" ]]; then

    sort -u "$used_hashes" -o "$used_hashes"

    while IFS= read -r cache_path; do

        hash="$(basename "$cache_path")"

        if ! grep -qxF "$hash" "$used_hashes"; then

            echo "PRUNE   $hash"

            rm -rf "$cache_path"

        fi

    done < <(
        find "$CACHE_DIR" \
            -mindepth 1 \
            -maxdepth 1 \
            -type d
    )

fi

# ============================================================
# Result
# ============================================================

echo
echo "========================================"
echo "Image processing finished"
echo "========================================"
echo "Processed : $processed"
echo "Cached    : $cached"
echo "Failed    : $failed"
echo "========================================"

if (( failed > 0 )); then
    exit 1
fi
