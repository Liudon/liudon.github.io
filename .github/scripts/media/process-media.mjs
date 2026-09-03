import sharp from "sharp";

import {
    access,
    copyFile,
    mkdir,
    readdir,
    rm,
    stat,
} from "node:fs/promises";

import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import path from "node:path";


// ============================================================
// Paths
// ============================================================

const ROOT = process.cwd();

const CONTENT_DIR =
    path.join(ROOT, "content/posts");

const CACHE_DIR =
    path.join(ROOT, ".cache/media");

const IMAGE_CACHE_DIR =
    path.join(CACHE_DIR, "images");

const VIDEO_CACHE_DIR =
    path.join(CACHE_DIR, "videos");

const FONT =
    path.join(
        ROOT,
        "static/ArchitectsDaughter-Regular.ttf"
    );

const SCRIPT_FILE =
    fileURLToPath(import.meta.url);


// ============================================================
// Image configuration
// ============================================================

const IMAGE_MAX_WIDTH = 1080;

const RESPONSIVE_WIDTHS = [
    320,
    480,
    720,
    1080,
];


// fallback JPG

const JPEG_QUALITY = 82;


// WebP

const WEBP_PHOTO_QUALITY = 75;
const WEBP_PICTURE_QUALITY = 80;


// AVIF

const AVIF_PHOTO_QUALITY = 50;
const AVIF_PICTURE_QUALITY = 55;


// ============================================================
// Watermark
// ============================================================

const WATERMARK_TEXT =
    "@liudon\nhttps://liudon.com";

const WATERMARK_COLOR =
    "#909090";

const WATERMARK_POINTSIZE = 48;

const WATERMARK_BOTTOM = 20;


// ============================================================
// Video configuration
// ============================================================

// 最大边 1280
//
// 横屏：
// 3840x2160 -> 1280x720
//
// 竖屏：
// 2160x3840 -> 720x1280

const VIDEO_MAX_EDGE = 1280;


// 平均码率高于 3500kbps 时压缩

const VIDEO_MAX_BITRATE_KBPS = 3500;


// H.264 CRF
//
// 23：质量和体积比较均衡

const VIDEO_CRF = 23;

const VIDEO_PRESET = "medium";


// 非 AAC 音频转换参数

const VIDEO_AUDIO_BITRATE = "128k";


// Poster

const POSTER_MAX_WIDTH = 1080;

const POSTER_QUALITY = 82;


// ============================================================
// Statistics
// ============================================================

let imageProcessed = 0;
let imageCached = 0;

let videoProcessed = 0;
let videoCached = 0;


// ============================================================
// Cache tracking
// ============================================================

const usedImageCaches = new Set();
const usedVideoCaches = new Set();


// ============================================================
// Basic utilities
// ============================================================

async function exists(file) {

    try {

        await access(file);

        return true;

    } catch {

        return false;
    }
}


async function sha256File(file) {

    return new Promise(
        (resolve, reject) => {

            const hash =
                createHash("sha256");

            const stream =
                createReadStream(file);

            stream.on(
                "data",
                chunk => hash.update(chunk)
            );

            stream.on(
                "error",
                reject
            );

            stream.on(
                "end",
                () => resolve(
                    hash.digest("hex")
                )
            );
        }
    );
}


function sha256String(value) {

    return createHash("sha256")
        .update(value)
        .digest("hex");
}


async function walk(dir) {

    const output = [];

    const entries =
        await readdir(
            dir,
            {
                withFileTypes: true,
            }
        );

    for (const entry of entries) {

        const full =
            path.join(
                dir,
                entry.name
            );

        if (entry.isDirectory()) {

            output.push(
                ...(await walk(full))
            );

        } else {

            output.push(full);
        }
    }

    return output;
}


// ============================================================
// Execute external command
// ============================================================

function run(
    command,
    args,
    {
        quiet = false,
    } = {}
) {

    return new Promise(
        (resolve, reject) => {

            const child =
                spawn(
                    command,
                    args,
                    {
                        stdio: [
                            "ignore",
                            "pipe",
                            "pipe",
                        ],
                    }
                );

            let stdout = "";
            let stderr = "";

            child.stdout.on(
                "data",
                data => {

                    stdout +=
                        data.toString();
                }
            );

            child.stderr.on(
                "data",
                data => {

                    stderr +=
                        data.toString();

                    if (!quiet) {

                        process.stderr.write(
                            data
                        );
                    }
                }
            );

            child.on(
                "error",
                reject
            );

            child.on(
                "close",
                code => {

                    if (code === 0) {

                        resolve({
                            stdout,
                            stderr,
                        });

                        return;
                    }

                    reject(
                        new Error(
                            `${command} failed with code ${code}\n${stderr}`
                        )
                    );
                }
            );
        }
    );
}


// ============================================================
// Image validation
// ============================================================

async function validateImage(
    file,
    expectedMediaType = null
) {

    if (!(await exists(file))) {

        return false;
    }

    try {

        const metadata =
            await sharp(file).metadata();

        if (
            !metadata.width ||
            !metadata.height
        ) {

            return false;
        }

        if (
            expectedMediaType &&
            metadata.mediaType !==
                expectedMediaType
        ) {

            return false;
        }

        return true;

    } catch {

        return false;
    }
}


// ============================================================
// Image orientation
// ============================================================

function getOrientedDimensions(metadata) {

    let width =
        metadata.width;

    let height =
        metadata.height;

    if (
        [
            5,
            6,
            7,
            8,
        ].includes(metadata.orientation)
    ) {

        [
            width,
            height,
        ] = [
            height,
            width,
        ];
    }

    return {
        width,
        height,
    };
}


// ============================================================
// Watermark
// ============================================================

async function createWatermark(
    targetWidth
) {

    // 防止小图中文字宽度超过图片。

    const maxWidth =
        Math.max(
            1,
            targetWidth - 20
        );

    const markup =
        `<span foreground="${WATERMARK_COLOR}">` +
        WATERMARK_TEXT +
        "</span>";

    return await sharp({
        text: {
            text:
                markup,

            font:
                `Architects Daughter ${WATERMARK_POINTSIZE}`,

            fontfile:
                FONT,

            width:
                maxWidth,

            align:
                "center",

            rgba:
                true,

            dpi:
                72,
        },
    })
        .png()
        .toBuffer({
            resolveWithObject: true,
        });
}


// ============================================================
// Restore image outputs
// ============================================================

function responsiveImagePath(
    src,
    width,
    format
) {

    const parsed =
        path.parse(src);

    return path.join(
        parsed.dir,
        `${parsed.name}_${width}x.${format}`
    );
}


async function restoreImageOutputs(
    src,
    base,
    cacheDir,
    widths
) {

    // fallback 原图

    await copyFile(
        base,
        src
    );


    // responsive variants

    for (const width of widths) {

        await copyFile(
            path.join(
                cacheDir,
                `${width}.webp`
            ),
            responsiveImagePath(
                src,
                width,
                "webp"
            )
        );

        await copyFile(
            path.join(
                cacheDir,
                `${width}.avif`
            ),
            responsiveImagePath(
                src,
                width,
                "avif"
            )
        );
    }
}


// ============================================================
// Process image
// ============================================================

async function processImage(
    src,
    scriptHash,
    fontHash
) {

    const ext =
        path.extname(src)
            .toLowerCase();

    const imageType =
        ext === ".png"
            ? "picture"
            : "photo";

    const webpQuality =
        imageType === "photo"
            ? WEBP_PHOTO_QUALITY
            : WEBP_PICTURE_QUALITY;

    const avifQuality =
        imageType === "photo"
            ? AVIF_PHOTO_QUALITY
            : AVIF_PICTURE_QUALITY;


    // --------------------------------------------------------
    // Source metadata
    // --------------------------------------------------------

    const metadata =
        await sharp(src).metadata();

    const oriented =
        getOrientedDimensions(
            metadata
        );

    const targetWidth =
        Math.min(
            IMAGE_MAX_WIDTH,
            oriented.width
        );


    // --------------------------------------------------------
    // Cache hash
    // --------------------------------------------------------

    const sourceHash =
        await sha256File(src);

    const config =
        JSON.stringify({
            type:
                "image",

            sourceHash,

            scriptHash,

            fontHash,

            IMAGE_MAX_WIDTH,

            RESPONSIVE_WIDTHS,

            JPEG_QUALITY,

            webpQuality,

            avifQuality,

            WATERMARK_TEXT,

            WATERMARK_COLOR,

            WATERMARK_POINTSIZE,

            WATERMARK_BOTTOM,
        });

    const hash =
        sha256String(config);

    usedImageCaches.add(hash);

    const cacheDir =
        path.join(
            IMAGE_CACHE_DIR,
            hash
        );

    await mkdir(
        cacheDir,
        {
            recursive: true,
        }
    );


    // --------------------------------------------------------
    // Widths
    //
    // 1080 -> 320 / 480 / 720 / 1080
    // 900  -> 320 / 480 / 720 / 900
    // 600  -> 320 / 480 / 600
    // --------------------------------------------------------

    const widths = [
        ...RESPONSIVE_WIDTHS.filter(
            width =>
                width <= targetWidth
        ),
        targetWidth,
    ];

    const finalWidths =
        [...new Set(widths)]
            .sort(
                (a, b) =>
                    a - b
            );


    const base =
        path.join(
            cacheDir,
            `source${ext}`
        );


    // --------------------------------------------------------
    // Cache validation
    // --------------------------------------------------------

    let cacheOK =
        await validateImage(base);

    if (cacheOK) {

        for (const width of finalWidths) {

            const webp =
                path.join(
                    cacheDir,
                    `${width}.webp`
                );

            const avif =
                path.join(
                    cacheDir,
                    `${width}.avif`
                );

            if (
                !(await validateImage(
                    webp,
                    "image/webp"
                )) ||
                !(await validateImage(
                    avif,
                    "image/avif"
                ))
            ) {

                cacheOK = false;

                break;
            }
        }
    }


    // --------------------------------------------------------
    // Cache hit
    // --------------------------------------------------------

    if (cacheOK) {

        console.log(
            `CACHE IMAGE   ${path.relative(ROOT, src)}`
        );

        await restoreImageOutputs(
            src,
            base,
            cacheDir,
            finalWidths
        );

        imageCached++;

        return;
    }


    // --------------------------------------------------------
    // Cache miss
    // --------------------------------------------------------

    console.log();
    console.log(
        `PROCESS IMAGE ${path.relative(ROOT, src)}`
    );

    await rm(
        cacheDir,
        {
            recursive: true,
            force: true,
        }
    );

    await mkdir(
        cacheDir,
        {
            recursive: true,
        }
    );


    // --------------------------------------------------------
    // Calculate final base dimensions
    // --------------------------------------------------------

    const scale =
        targetWidth /
        oriented.width;

    const targetHeight =
        Math.max(
            1,
            Math.round(
                oriented.height * scale
            )
        );


    // --------------------------------------------------------
    // Watermark
    // --------------------------------------------------------

    let watermark =
        await createWatermark(
            targetWidth
        );

    // 极端小图情况下避免 watermark 高于图片。

    const maxWatermarkHeight =
        Math.max(
            1,
            targetHeight -
            WATERMARK_BOTTOM
        );

    if (
        watermark.info.height >
        maxWatermarkHeight
    ) {

        const resized =
            await sharp(watermark.data)
                .resize({
                    height:
                        maxWatermarkHeight,

                    withoutEnlargement:
                        true,
                })
                .png()
                .toBuffer({
                    resolveWithObject:
                        true,
                });

        watermark = resized;
    }


    const left =
        Math.max(
            0,
            Math.round(
                (
                    targetWidth -
                    watermark.info.width
                ) / 2
            )
        );

    const top =
        Math.max(
            0,
            targetHeight -
            watermark.info.height -
            WATERMARK_BOTTOM
        );


    // --------------------------------------------------------
    // Generate fallback/base
    // --------------------------------------------------------

    let pipeline =
        sharp(src)
            .rotate()
            .resize({
                width:
                    IMAGE_MAX_WIDTH,

                withoutEnlargement:
                    true,

                fit:
                    "inside",
            })
            .toColourspace(
                "srgb"
            )
            .composite([
                {
                    input:
                        watermark.data,

                    left,

                    top,
                },
            ]);


    if (ext === ".png") {

        pipeline =
            pipeline.png({
                compressionLevel:
                    9,

                adaptiveFiltering:
                    true,
            });

    } else {

        pipeline =
            pipeline.jpeg({
                quality:
                    JPEG_QUALITY,

                progressive:
                    true,

                optimiseCoding:
                    true,
            });
    }


    await pipeline.toFile(base);


    if (!(await validateImage(base))) {

        throw new Error(
            `Invalid processed image: ${src}`
        );
    }


    // --------------------------------------------------------
    // Get actual width
    // --------------------------------------------------------

    const baseMetadata =
        await sharp(base).metadata();

    const actualWidth =
        baseMetadata.width;


    const actualWidths = [
        ...RESPONSIVE_WIDTHS.filter(
            width =>
                width <= actualWidth
        ),
        actualWidth,
    ];

    const outputWidths =
        [...new Set(actualWidths)]
            .sort(
                (a, b) =>
                    a - b
            );


    // --------------------------------------------------------
    // WebP + AVIF
    // --------------------------------------------------------

    for (const width of outputWidths) {

        console.log(
            `        generate ${width}w`
        );

        const webp =
            path.join(
                cacheDir,
                `${width}.webp`
            );

        const avif =
            path.join(
                cacheDir,
                `${width}.avif`
            );


        await sharp(base)
            .resize({
                width,

                withoutEnlargement:
                    true,
            })
            .webp({
                quality:
                    webpQuality,

                effort:
                    6,

                preset:
                    imageType,
            })
            .toFile(webp);


        await sharp(base)
            .resize({
                width,

                withoutEnlargement:
                    true,
            })
            .avif({
                quality:
                    avifQuality,

                effort:
                    5,

                chromaSubsampling:
                    imageType === "photo"
                        ? "4:2:0"
                        : "4:4:4",
            })
            .toFile(avif);


        if (
            !(await validateImage(
                webp,
                "image/webp"
            ))
        ) {

            throw new Error(
                `Invalid WebP: ${webp}`
            );
        }


        if (
            !(await validateImage(
                avif,
                "image/avif"
            ))
        ) {

            throw new Error(
                `Invalid AVIF: ${avif}`
            );
        }
    }


    await restoreImageOutputs(
        src,
        base,
        cacheDir,
        outputWidths
    );


    // --------------------------------------------------------
    // Stats
    // --------------------------------------------------------

    const largestWidth =
        outputWidths.at(-1);

    const baseStat =
        await stat(base);

    const webpStat =
        await stat(
            path.join(
                cacheDir,
                `${largestWidth}.webp`
            )
        );

    const avifStat =
        await stat(
            path.join(
                cacheDir,
                `${largestWidth}.avif`
            )
        );


    console.log(
        `        size     : ${baseMetadata.width}x${baseMetadata.height}`
    );

    console.log(
        `        variants : ${outputWidths.join(",")}`
    );

    console.log(
        `        base     : ${(baseStat.size / 1024).toFixed(1)} KB`
    );

    console.log(
        `        webp max : ${(webpStat.size / 1024).toFixed(1)} KB`
    );

    console.log(
        `        avif max : ${(avifStat.size / 1024).toFixed(1)} KB`
    );


    imageProcessed++;
}


// ============================================================
// FFprobe
// ============================================================

async function probeVideo(file) {

    const result =
        await run(
            "ffprobe",
            [
                "-v",
                "error",

                "-show_entries",
                "format=duration,bit_rate:stream=codec_type,codec_name,width,height,pix_fmt",

                "-of",
                "json",

                file,
            ],
            {
                quiet: true,
            }
        );

    return JSON.parse(
        result.stdout
    );
}


// ============================================================
// Validate processed video
// ============================================================

async function validateVideo(file) {

    if (!(await exists(file))) {

        return false;
    }

    try {

        const probe =
            await probeVideo(file);

        const video =
            probe.streams.find(
                stream =>
                    stream.codec_type ===
                    "video"
            );

        if (!video) {

            return false;
        }

        if (
            video.codec_name !== "h264"
        ) {

            return false;
        }

        if (
            video.pix_fmt !== "yuv420p"
        ) {

            return false;
        }

        if (
            Math.max(
                Number(video.width || 0),
                Number(video.height || 0)
            ) >
            VIDEO_MAX_EDGE
        ) {

            return false;
        }

        return true;

    } catch {

        return false;
    }
}


// ============================================================
// Process MP4
// ============================================================

async function processVideo(
    src,
    scriptHash
) {

    const sourceStat =
        await stat(src);

    const sourceHash =
        await sha256File(src);

    const probe =
        await probeVideo(src);


    const video =
        probe.streams.find(
            stream =>
                stream.codec_type ===
                "video"
        );

    const audio =
        probe.streams.find(
            stream =>
                stream.codec_type ===
                "audio"
        );


    if (!video) {

        throw new Error(
            `Video stream not found: ${src}`
        );
    }


    const width =
        Number(video.width || 0);

    const height =
        Number(video.height || 0);

    const duration =
        Number(
            probe.format.duration || 0
        );


    // --------------------------------------------------------
    // Calculate bitrate
    // --------------------------------------------------------

    let bitrateKbps =
        Number(
            probe.format.bit_rate || 0
        ) / 1000;


    // 某些 MP4 没有 bit_rate，
    // 用文件大小 / 时长估算。

    if (
        bitrateKbps <= 0 &&
        duration > 0
    ) {

        bitrateKbps =
            (
                sourceStat.size *
                8 /
                duration /
                1000
            );
    }


    // --------------------------------------------------------
    // Decide transcode
    // --------------------------------------------------------

    const transcodeVideo =
        video.codec_name !== "h264" ||

        video.pix_fmt !== "yuv420p" ||

        Math.max(
            width,
            height
        ) > VIDEO_MAX_EDGE ||

        (
            bitrateKbps > 0 &&
            bitrateKbps >
                VIDEO_MAX_BITRATE_KBPS
        );


    const transcodeAudio =
        Boolean(
            audio &&
            audio.codec_name !== "aac"
        );


    // --------------------------------------------------------
    // Cache hash
    // --------------------------------------------------------

    const config =
        JSON.stringify({
            type:
                "video",

            sourceHash,

            scriptHash,

            VIDEO_MAX_EDGE,

            VIDEO_MAX_BITRATE_KBPS,

            VIDEO_CRF,

            VIDEO_PRESET,

            VIDEO_AUDIO_BITRATE,

            POSTER_MAX_WIDTH,

            POSTER_QUALITY,

            transcodeVideo,

            transcodeAudio,
        });


    const hash =
        sha256String(config);

    usedVideoCaches.add(hash);

    const cacheDir =
        path.join(
            VIDEO_CACHE_DIR,
            hash
        );

    const outputVideo =
        path.join(
            cacheDir,
            "video.mp4"
        );

    const poster =
        path.join(
            cacheDir,
            "poster.webp"
        );


    await mkdir(
        cacheDir,
        {
            recursive: true,
        }
    );


    // --------------------------------------------------------
    // Cache hit
    // --------------------------------------------------------

    if (
        await validateVideo(outputVideo) &&
        await validateImage(
            poster,
            "image/webp"
        )
    ) {

        console.log(
            `CACHE VIDEO   ${path.relative(ROOT, src)}`
        );

        await copyFile(
            outputVideo,
            src
        );

        await copyFile(
            poster,
            `${src}.poster.webp`
        );

        videoCached++;

        return;
    }


    // --------------------------------------------------------
    // Cache miss
    // --------------------------------------------------------

    console.log();
    console.log(
        `PROCESS VIDEO ${path.relative(ROOT, src)}`
    );

    console.log(
        `        video    : ${video.codec_name}`
    );

    console.log(
        `        pix_fmt  : ${video.pix_fmt}`
    );

    console.log(
        `        audio    : ${audio?.codec_name || "none"}`
    );

    console.log(
        `        size     : ${width}x${height}`
    );

    console.log(
        `        bitrate  : ${bitrateKbps.toFixed(0)} kbps`
    );

    console.log(
        `        duration : ${duration.toFixed(1)} sec`
    );


    await rm(
        cacheDir,
        {
            recursive: true,
            force: true,
        }
    );

    await mkdir(
        cacheDir,
        {
            recursive: true,
        }
    );


    // --------------------------------------------------------
    // FFmpeg
    // --------------------------------------------------------

    const args = [
        "-hide_banner",
        "-loglevel",
        "warning",

        "-y",

        "-i",
        src,

        "-map",
        "0:v:0",

        "-map",
        "0:a?",

        "-map_metadata",
        "0",
    ];


    // --------------------------------------------------------
    // Video codec
    // --------------------------------------------------------

    if (transcodeVideo) {

        args.push(
            "-vf",
            `scale=w='min(iw,${VIDEO_MAX_EDGE})':h='min(ih,${VIDEO_MAX_EDGE})':force_original_aspect_ratio=decrease:force_divisible_by=2`,

            "-c:v",
            "libx264",

            "-preset",
            VIDEO_PRESET,

            "-crf",
            String(VIDEO_CRF),

            "-pix_fmt",
            "yuv420p"
        );

    } else {

        args.push(
            "-c:v",
            "copy"
        );
    }


    // --------------------------------------------------------
    // Audio codec
    // --------------------------------------------------------

    if (audio) {

        if (transcodeAudio) {

            args.push(
                "-c:a",
                "aac",

                "-b:a",
                VIDEO_AUDIO_BITRATE
            );

        } else {

            args.push(
                "-c:a",
                "copy"
            );
        }
    }


    // --------------------------------------------------------
    // MP4 fast start
    //
    // 把 moov atom 放文件前部，
    // 浏览器不用等下载完整视频才能开始播放。
    // --------------------------------------------------------

    args.push(
        "-movflags",
        "+faststart",

        outputVideo
    );


    if (transcodeVideo) {

        console.log(
            "        mode     : transcode"
        );

    } else if (transcodeAudio) {

        console.log(
            "        mode     : audio transcode"
        );

    } else {

        console.log(
            "        mode     : remux"
        );
    }


    await run(
        "ffmpeg",
        args
    );


    // --------------------------------------------------------
    // Validate video
    // --------------------------------------------------------

    if (!(await validateVideo(outputVideo))) {

        throw new Error(
            `Invalid generated video: ${src}`
        );
    }


    // --------------------------------------------------------
    // Poster frame
    //
    // 取视频 10% 位置，
    // 最大不超过第 3 秒。
    // --------------------------------------------------------

    const posterTime =
        duration > 0
            ? Math.min(
                3,
                duration * 0.1
            )
            : 0;


    const frame =
        path.join(
            cacheDir,
            "poster-frame.png"
        );


    await run(
        "ffmpeg",
        [
            "-hide_banner",
            "-loglevel",
            "error",

            "-y",

            "-i",
            outputVideo,

            "-ss",
            posterTime.toFixed(3),

            "-frames:v",
            "1",

            "-an",

            frame,
        ]
    );


    if (!(await validateImage(frame))) {

        throw new Error(
            `Failed to generate video poster: ${src}`
        );
    }


    // --------------------------------------------------------
    // Poster -> WebP
    // --------------------------------------------------------

    await sharp(frame)
        .resize({
            width:
                POSTER_MAX_WIDTH,

            withoutEnlargement:
                true,
        })
        .webp({
            quality:
                POSTER_QUALITY,

            effort:
                6,
        })
        .toFile(poster);


    await rm(
        frame,
        {
            force: true,
        }
    );


    if (
        !(await validateImage(
            poster,
            "image/webp"
        ))
    ) {

        throw new Error(
            `Invalid poster: ${poster}`
        );
    }


    // --------------------------------------------------------
    // Copy back into Hugo page bundle
    // --------------------------------------------------------

    await copyFile(
        outputVideo,
        src
    );

    await copyFile(
        poster,
        `${src}.poster.webp`
    );


    // --------------------------------------------------------
    // Stats
    // --------------------------------------------------------

    const outputStat =
        await stat(outputVideo);

    const posterStat =
        await stat(poster);


    console.log(
        `        input    : ${(sourceStat.size / 1024 / 1024).toFixed(2)} MB`
    );

    console.log(
        `        output   : ${(outputStat.size / 1024 / 1024).toFixed(2)} MB`
    );

    console.log(
        `        poster   : ${(posterStat.size / 1024).toFixed(1)} KB`
    );


    videoProcessed++;
}


// ============================================================
// Prune obsolete per-file cache
// ============================================================

async function pruneCache(
    dir,
    used
) {

    if (!(await exists(dir))) {

        return;
    }

    const entries =
        await readdir(
            dir,
            {
                withFileTypes: true,
            }
        );


    for (const entry of entries) {

        if (!entry.isDirectory()) {

            continue;
        }


        if (!used.has(entry.name)) {

            console.log(
                `PRUNE CACHE   ${path.relative(ROOT, path.join(dir, entry.name))}`
            );

            await rm(
                path.join(
                    dir,
                    entry.name
                ),
                {
                    recursive: true,
                    force: true,
                }
            );
        }
    }
}


// ============================================================
// Main
// ============================================================

async function main() {

    await mkdir(
        IMAGE_CACHE_DIR,
        {
            recursive: true,
        }
    );

    await mkdir(
        VIDEO_CACHE_DIR,
        {
            recursive: true,
        }
    );


    if (!(await exists(FONT))) {

        throw new Error(
            `Watermark font not found: ${FONT}`
        );
    }


    const scriptHash =
        await sha256File(
            SCRIPT_FILE
        );

    const fontHash =
        await sha256File(
            FONT
        );


    // --------------------------------------------------------
    // Runtime info
    // --------------------------------------------------------

    const ffmpegVersion =
        await run(
            "ffmpeg",
            [
                "-version",
            ],
            {
                quiet: true,
            }
        );


    console.log(
        "========================================"
    );

    console.log(
        "Media environment"
    );

    console.log(
        "========================================"
    );

    console.log(
        `Sharp   : ${sharp.versions.sharp}`
    );

    console.log(
        `libvips : ${sharp.versions.vips}`
    );

    console.log(
        `FFmpeg  : ${ffmpegVersion.stdout.split("\n")[0]}`
    );

    console.log();


    // --------------------------------------------------------
    // Find sources
    // --------------------------------------------------------

    const files =
        await walk(
            CONTENT_DIR
        );


    const images =
        files.filter(file => {

            const ext =
                path.extname(file)
                    .toLowerCase();

            return [
                ".jpg",
                ".jpeg",
                ".png",
            ].includes(ext);
        });


    const videos =
        files.filter(file => {

            return (
                path.extname(file)
                    .toLowerCase() ===
                ".mp4"
            );
        });


    console.log(
        `Images : ${images.length}`
    );

    console.log(
        `Videos : ${videos.length}`
    );

    console.log();


    // --------------------------------------------------------
    // Images
    // --------------------------------------------------------

    for (const image of images) {

        await processImage(
            image,
            scriptHash,
            fontHash
        );
    }


    // --------------------------------------------------------
    // Videos
    // --------------------------------------------------------

    for (const video of videos) {

        await processVideo(
            video,
            scriptHash
        );
    }


    // --------------------------------------------------------
    // Prune
    // --------------------------------------------------------

    await pruneCache(
        IMAGE_CACHE_DIR,
        usedImageCaches
    );

    await pruneCache(
        VIDEO_CACHE_DIR,
        usedVideoCaches
    );


    // --------------------------------------------------------
    // Result
    // --------------------------------------------------------

    console.log();

    console.log(
        "========================================"
    );

    console.log(
        "Media processing finished"
    );

    console.log(
        "========================================"
    );

    console.log(
        `Images processed : ${imageProcessed}`
    );

    console.log(
        `Images cached    : ${imageCached}`
    );

    console.log(
        `Videos processed : ${videoProcessed}`
    );

    console.log(
        `Videos cached    : ${videoCached}`
    );

    console.log(
        "========================================"
    );
}


main().catch(error => {

    console.error();

    console.error(
        "MEDIA PIPELINE FAILED"
    );

    console.error(
        error
    );

    process.exit(1);
});
