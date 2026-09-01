#!/usr/bin/env bash

set -euo pipefail

CONTENT_DIR="./content/posts"
CACHE_DIR=".cache/images"
FONT="./static/ArchitectsDaughter-Regular.ttf"

# ============================================================
# 图片处理参数
#
# 修改这里的参数后，由于整个脚本参与 GitHub Actions cache key，
# 下次构建会自动建立新的缓存。
# ============================================================

MAX_WIDTH=1080

JPEG_QUALITY=82

WEBP_PHOTO_QUALITY=75
WEBP_PICTURE_QUALITY=80

AVIF_PHOTO_QUALITY=50
AVIF_PICTURE_QUALITY=55

WATERMARK_TEXT=$'@liudon\nhttps://liudon.com'
WATERMARK_COLOR="#909090"
WATERMARK_POINTSIZE=48

mkdir -p "$CACHE_DIR"

if [[ ! -f "$FONT" ]]; then
    echo "ERROR: watermark font not found: $FONT"
    exit 1
fi

echo "ImageMagick version:"
magick -version

echo
echo "ImageMagick supported formats:"
magick -list format | grep -Ei 'AVIF|HEIC|WEBP|JPEG|PNG' || true
echo

processed=0
cached=0

# 用于清理当前站点已经不再使用的缓存项
used_hashes="$(mktemp)"
trap 'rm -f "$used_hashes"' EXIT

process_image() {
    local src="$1"

    local filename
    filename="$(basename "$src")"

    local ext="${src##*.}"
    local ext_lower="${ext,,}"

    # --------------------------------------------------------
    # 图片类型
    #
    # 暂时简单按扩展名判断：
    #
    # JPG/JPEG -> photo
    # PNG      -> picture
    #
    # 后面如果有需要，可以进一步自动识别截图/照片。
    # --------------------------------------------------------

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
            return
            ;;
    esac

    # --------------------------------------------------------
    # 内容 Hash
    #
    # 包含：
    # 1. 原始图片内容
    # 2. 水印字体
    # 3. 当前处理配置
    #
    # 所以：
    #
    # - 图片变化 -> cache miss
    # - 字体变化 -> cache miss
    # - 参数变化 -> cache miss
    # --------------------------------------------------------

    local config
    config="\
max_width=${MAX_WIDTH};\
type=${image_type};\
jpeg_quality=${JPEG_QUALITY};\
webp_quality=${webp_quality};\
avif_quality=${avif_quality};\
watermark=${WATERMARK_TEXT};\
watermark_color=${WATERMARK_COLOR};\
watermark_pointsize=${WATERMARK_POINTSIZE}"

    local hash
    hash="$(
        {
            sha256sum "$src"
            sha256sum "$FONT"
            printf '%s' "$config"
        } | sha256sum | awk '{print $1}'
    )"

    echo "$hash" >> "$used_hashes"

    local cache_dir="$CACHE_DIR/$hash"

    local base="$cache_dir/source.$ext_lower"
    local webp="$cache_dir/image.webp"
    local avif="$cache_dir/image.avif"

    mkdir -p "$cache_dir"

    # --------------------------------------------------------
    # Cache hit
    # --------------------------------------------------------

    if [[ -s "$base" && -s "$webp" && -s "$avif" ]]; then
        echo "CACHE   $src"

        cp "$base" "$src"
        cp "$webp" "${src}_1080x.webp"
        cp "$avif" "${src}_1080x.avif"

        cached=$((cached + 1))
        return
    fi

    # --------------------------------------------------------
    # Cache miss
    # --------------------------------------------------------

    echo "PROCESS $src"

    #
    # 先：
    #
    # auto-orient
    #      ↓
    # resize
    #      ↓
    # watermark
    #
    # 这样不同分辨率源图上的水印大小保持一致。
    #

    if [[ "$ext_lower" == "png" ]]; then

        magick "$src" \
            -auto-orient \
            -resize "${MAX_WIDTH}x>" \
            -pointsize "$WATERMARK_POINTSIZE" \
            -fill "$WATERMARK_COLOR" \
            -font "$FONT" \
            -gravity south \
            -annotate +0+20 "$WATERMARK_TEXT" \
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
            -annotate +0+20 "$WATERMARK_TEXT" \
            -quality "$JPEG_QUALITY" \
            "$base"

    fi

    # --------------------------------------------------------
    # WebP
    # --------------------------------------------------------

    magick "$base" \
        -quality "$webp_quality" \
        -define webp:image-hint="$image_type" \
        -define webp:method=6 \
        "$webp"

    # --------------------------------------------------------
    # AVIF
    # --------------------------------------------------------

    magick "$base" \
        -quality "$avif_quality" \
        "$avif"

    # --------------------------------------------------------
    # 输出回 Hugo content
    #
    # 文件命名保持与你现在完全一致：
    #
    # IMG.jpg
    # IMG.jpg_1080x.webp
    # IMG.jpg_1080x.avif
    # --------------------------------------------------------

    cp "$base" "$src"
    cp "$webp" "${src}_1080x.webp"
    cp "$avif" "${src}_1080x.avif"

    # 输出尺寸和文件大小，方便 Actions 中观察效果
    local dimensions
    dimensions="$(magick identify -format '%wx%h' "$base")"

    local source_size
    local webp_size
    local avif_size

    source_size="$(du -h "$base" | cut -f1)"
    webp_size="$(du -h "$webp" | cut -f1)"
    avif_size="$(du -h "$avif" | cut -f1)"

    echo "        size : $dimensions"
    echo "        base : $source_size"
    echo "        webp : $webp_size (q=$webp_quality)"
    echo "        avif : $avif_size (q=$avif_quality)"
    echo

    processed=$((processed + 1))
}

export -f process_image

# ------------------------------------------------------------
# 遍历所有原始图片
#
# 使用 -print0，避免文件名中有空格等字符时出问题。
# ------------------------------------------------------------

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

# ------------------------------------------------------------
# 删除已经不存在于当前 content/posts 中的旧缓存
#
# 避免随着删除/替换图片，缓存目录无限膨胀。
# ------------------------------------------------------------

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

echo
echo "========================================"
echo "Image processing finished"
echo "Processed : $processed"
echo "Cached    : $cached"
echo "========================================"
