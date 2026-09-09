---
title: "博客加速实践"
date: 2026-09-01T15:14:02+08:00
lastmod: 2026-09-09T00:00:00+08:00
draft: false
tags:
  - Hugo
  - Lighthouse
  - 博客优化
  - Avif
  - Core Web Vitals
keywords:
  - 博客性能优化
  - Hugo性能优化
  - Lighthouse优化
  - Hugo图片优化
  - 响应式图片
  - Twikoo延迟加载
  - Core Web Vitals
description: "记录一次博客完整的性能优化实践：响应式图片预生成和JS文件延迟加载。"
---

目前博客部署在 Cloudflare Pages 服务上，通过 DnsPod 服务做了国内和海外分线路解析。

```
Cloudflare Pages
       ↑
blog.liudon.xyz
   ↑         ↑
 回源       直接访问
   │         │
腾讯云 CDN    │
   ↑         ↑
   国内     海外
     \       /
      DNSPod
        ↑
    liudon.com
```

因为 Cloudflare 在国内属于反向加速，所以加了一层国内CDN做加速。

但总感觉博客访问不快，随便打开一个页面，页面完全处理完都要在秒级，实在是慢。

通过 Lighthouse 测试，借助 AI 的能力，又做了一轮新的优化。

## 1. 增加国内 CDN 节点缓存时间

腾讯 CDN 首页的响应：

```
cf-cache-status: DYNAMIC
cf-ray: ...-AMS
x-cache-lookup: Cache Miss
cache-control: public, must-revalidate, max-age=0
age: 0
x-nws-log-uuid: ...
```

请求确实经过腾讯云 CDN（x-nws-log-uuid），但腾讯边缘节点没有命中首页缓存，随后回源 Cloudflare，并落到 AMS（阿姆斯特丹）。

Cloudflare Pages 默认返回 max-age=0, must-revalidate，这是 Pages 的正常默认行为；但腾讯 CDN 如果“遵循源站”，就会频繁回源。

通过调整腾讯云 CDN 的缓存规则，增加强制缓存规则解决。

```
首页 缓存30分钟
/posts 缓存30分钟
/tags 缓存30分钟
/page 缓存30分钟
```

## 2. 延长指纹资源缓存时间

```
cache-control: public, must-revalidate, max-age=14400
age: 223
x-cache-lookup: Cache Hit
```

当前 CSS / JS 文件名已经包含 hash，可以设置更长的过期时间。

通过 _headers 文件配置缓存时间解决。

```
/assets/*
  Cache-Control: public, max-age=31536000, immutable
```

## 3. 修正响应式图片效果

终于来到这次优化的重头戏了。

这里之前其实做过一次优化，见[当Hugo遇上AVIF，优化图片加载](https://liudon.com/posts/use-avif-to-optimize-images-on-hugo/)。

当时引入了 AVIF 格式文件，增加了响应式图片效果。

但通过 Lighthouse 测试，仍有图片大小的问题。

比如[广府古城一日游](https://liudon.com/posts/guangfu-ancient-city-day-trip/)文章里，整个页面 Lighthouse 给出的图片优化空间是3,914 KiB，接近 4 MB。

当前页面的响应式代码如下：

```
<source
  type="image/avif"
  srcset="IMG_7537.PNG_1080x.avif 1080w"
  sizes="(min-width: 768px) 1080px, 100vw"
>
```

这里只有 1080x 这一个规格，并不能发挥响应式图片的作用。

这里是我理解有误，我理解成浏览器是按页面屏幕大小来做选择了，实际上是按这个元素的占位大小来选择不同规格。

页面里多图并排的情况，也会下载 1080x 这个规格的文件，导致大量的流量浪费。

另外还有一个问题是，现在的 AVIF / WEBP 格式文件都是提前预处理的。

因为每次都是全量生成，虽然现在只生成一个规格，但每次执行耗时都要在 10 分钟以上。

如果生成多个规格文件，会导致 Github Actions 执行非常慢。

怎么优化这个耗时，一直想优化来着，苦于找不到好的方案。

将这些问题反馈给 AI，给出了如下的方案：

通过预生成多个规格的 AVIF / WEBP 文件做响应式图片；

通过增加流水线缓存，避免每次都全量生成，只做增量更新。

### 3.1 流水线增加媒体处理逻辑

新增.github/scripts/media/package.json文件，内容如下：

```
{
  "name": "liudon-media-pipeline",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=24"
  },
  "dependencies": {
    "sharp": "0.35.0"
  }
}
```

新增 `.github/scripts/media/process-media.mjs`，负责统一处理文章中的图片和视频。脚本较长，正文只保留处理流程，完整实现可以直接查看仓库中的 [`process-media.mjs`](https://github.com/Liudon/liudon.github.io/blob/code/.github/scripts/media/process-media.mjs)：

1. 递归扫描文章目录中的 JPG、JPEG、PNG 和 MP4 文件。
2. 根据源文件内容和处理配置生成缓存键，未变化的文件直接复用缓存。
3. 按 320、480、720、1080 像素生成响应式图片，不放大尺寸较小的原图。
4. 使用 Sharp 同时生成 AVIF 和 WebP，供浏览器按支持情况选择。
5. 使用 FFmpeg 处理视频并生成封面，避免在 Hugo 构建阶段重复执行重任务。

这样可以把耗时的媒体转换放到 GitHub Actions 预处理阶段，Hugo 构建时只需要读取已经生成好的文件。

调整 `.github/workflows/main.yml` 文件，修改预处理逻辑为下面内容：

```
      # ------------------------------------------------------
      # Media cache
      #
      # 第一次：
      #
      # media-v1 不存在
      # -> 全量图片 + 视频处理
      #
      # 后续：
      #
      # source 未变化
      # -> exact cache hit
      #
      # 修改一张图片/视频
      # -> restore 最近的 media-v1
      # -> 只处理变化文件
      # ------------------------------------------------------

      - name: Restore media cache
        uses: actions/cache@v5
        with:
          path: .cache/media
          key: media-v1-${{ hashFiles('content/posts/**/*.jpg', 'content/posts/**/*.jpeg', 'content/posts/**/*.png', 'content/posts/**/*.JPG', 'content/posts/**/*.JPEG', 'content/posts/**/*.PNG', 'content/posts/**/*.mp4', 'content/posts/**/*.MP4', 'static/ArchitectsDaughter-Regular.ttf', '.github/scripts/media/package.json', '.github/scripts/media/process-media.mjs') }}
          restore-keys: |
            media-v1-

      # ------------------------------------------------------
      # Node.js
      # ------------------------------------------------------

      - name: Setup Node.js
        uses: actions/setup-node@v7
        with:
          node-version: "24"
          package-manager-cache: false

      # ------------------------------------------------------
      # Sharp
      #
      # 使用 Sharp 官方预编译 Linux 二进制。
      #
      # 不再需要：
      #
      # build-essential
      # libheif-dev
      # libaom-dev
      # libwebp-dev
      # ImageMagick configure/make
      # ------------------------------------------------------

      - name: Install Sharp
        run: |
          npm install \
            --prefix .github/scripts/media \
            --omit=dev \
            --no-audit \
            --no-fund

      # ------------------------------------------------------
      # FFmpeg
      # ------------------------------------------------------

      - name: Setup FFmpeg
        shell: bash
        run: |
          set -euo pipefail

          NEED_APT=0

          if ! command -v ffmpeg >/dev/null 2>&1; then
            NEED_APT=1
          fi

          if ! command -v ffprobe >/dev/null 2>&1; then
            NEED_APT=1
          fi

          if ! command -v fc-match >/dev/null 2>&1; then
            NEED_APT=1
          fi

          if [[ "$NEED_APT" == "1" ]]; then
            sudo apt-get update

            sudo apt-get install -y \
              ffmpeg \
              fontconfig
          fi

          echo
          echo "FFmpeg:"
          ffmpeg -version | head -n 1

          echo
          echo "FFprobe:"
          ffprobe -version | head -n 1

          echo
          echo "Checking H.264 encoder..."

          if ! ffmpeg -hide_banner -encoders 2>/dev/null | grep -q libx264; then
            echo "ERROR: FFmpeg does not contain libx264 encoder"
            exit 1
          fi

          echo "libx264: OK"

      # ------------------------------------------------------
      # Process images + videos
      # ------------------------------------------------------

      - name: Process media
        run: |
          node .github/scripts/media/process-media.mjs
```

把 ImageMagick 换成了 Sharp，压缩后的文件更小一些。

### 3.2 Hugo 图片解析响应式调整

[当前 Hugo 已经可以处理 AVIF](https://gohugo.io/content-management/image-processing/)；本站继续在 GitHub Actions 中使用 Sharp 预生成 AVIF/WebP，是为了复用媒体缓存，并避免在 Hugo 生产构建阶段集中处理大量原图。当前主题将 Markdown 图片和 `figure` 短代码共用的逻辑收敛到了 [`responsive-image.html`](https://github.com/Liudon/liudon.github.io/blob/code/themes/terminal/layouts/partials/responsive-image.html)，下面保留的是本次优化时的实现记录。

新增 layouts/_default/_markup/render-image.html文件，内容如下：

```
{{- /*
响应式图片尺寸：

普通大图：
320 / 480 / 720 / 1080

如果源图片小于 1080：
还会自动加入图片实际宽度。

例如：
源图 900px
→ 320 / 480 / 720 / 900

源图 600px
→ 320 / 480 / 600
*/ -}}

{{- $respSizes := slice 320 480 720 1080 -}}

{{- /*
auto:
现代浏览器根据 CSS 布局后的实际尺寸选择图片。

fallback:
如果浏览器不支持 auto，则最大按照 1080px 处理。
*/ -}}

{{- $dataSizes := site.Params.responsiveImageSizes | default "auto, (min-width: 1080px) 1080px, calc(100vw - 32px)" -}}

{{- $filter := "box" -}}

{{- $Destination := .Destination -}}
{{- $Page := .Page -}}
{{- $Text := .Text -}}
{{- $Title := .Title -}}

{{- $responsiveImages := (.Page.Params.responsiveImages | default site.Params.responsiveImages) | default true -}}

{{- with $src := .Page.Resources.GetMatch .Destination -}}

    {{- if $responsiveImages -}}

        {{- /*
        根据源图片宽度生成实际候选尺寸。

        最大不会超过源图。
        */ -}}

        {{- $candidateSizes := slice -}}

        {{- range $size := $respSizes -}}
            {{- if ge $src.Width $size -}}
                {{- $candidateSizes = $candidateSizes | append $size -}}
            {{- end -}}
        {{- end -}}

        {{- /*
        如果源图片实际宽度不是标准档位，
        把实际宽度作为最后一档。

        例如 900px：
        320 / 480 / 720 / 900
        */ -}}

        {{- if not (in $candidateSizes $src.Width) -}}
            {{- $candidateSizes = $candidateSizes | append $src.Width -}}
        {{- end -}}

        {{- /*
        优先 AVIF，再 WebP。
        */ -}}

        {{- $imageTypes := slice "avif" "webp" -}}

        <picture>

            {{- range $imageType := $imageTypes -}}

                {{- $srcset := slice -}}

                {{- range $size := $candidateSizes -}}

                    {{- $compressedImage := printf "%s_%dx.%s" $Destination $size $imageType -}}

                    {{- $cmSrc := $Page.Resources.GetMatch $compressedImage -}}

                    {{- if $cmSrc -}}

                        {{- $url := $cmSrc.RelPermalink | absURL -}}

                        {{- /*
                        用实际图片宽度作为 descriptor，
                        不依赖文件名里的数字。
                        */ -}}

                        {{- $candidate := printf "%s %dw" $url $cmSrc.Width -}}

                        {{- $srcset = $srcset | append $candidate -}}

                    {{- else if and (eq $imageType "webp") hugo.IsExtended -}}

                        {{- /*
                        本地 hugo server 没有预处理文件时，
                        WebP 仍然可以让 Hugo 自己生成。

                        AVIF 则依赖 GitHub Action 预处理。
                        */ -}}

                        {{- $resized := $src.Resize (printf "%dx %s %s" $size $imageType $filter) -}}

                        {{- $url := $resized.RelPermalink | absURL -}}

                        {{- $candidate := printf "%s %dw" $url $resized.Width -}}

                        {{- $srcset = $srcset | append $candidate -}}

                    {{- end -}}

                {{- end -}}

                {{- if gt (len $srcset) 0 -}}

                    <source
                        type="image/{{ $imageType }}"
                        srcset="{{ delimit $srcset ", " }}"
                        sizes="{{ $dataSizes }}"
                    />

                {{- end -}}

            {{- end -}}

            <img
                src="{{ $Destination | safeURL }}"
                width="{{ $src.Width }}"
                height="{{ $src.Height }}"
                alt="{{ $Text }}"
                {{- with $Title }}
                title="{{ . }}"
                {{- end }}
                loading="lazy"
                decoding="async"
            />

        </picture>

    {{- else -}}

        <img
            src="{{ $Destination | safeURL }}"
            width="{{ $src.Width }}"
            height="{{ $src.Height }}"
            alt="{{ $Text }}"
            {{- with $Title }}
            title="{{ . }}"
            {{- end }}
            loading="lazy"
            decoding="async"
        />

    {{- end -}}

{{- end -}}
```

第一次执行需要处理全量文件，输出类似如下：

```text
Images processed : N
Images cached    : 0
```

再次执行，输出类似如下：

```text
CACHE IMAGE ...
CACHE IMAGE ...

Images processed : 0
Images cached    : N
```

至此，图片响应式问题搞定了，流水线的耗时问题也解决了，目前控制在3分钟左右。

本地预览可以使用 development 环境，跳过响应式图片变体生成：

```bash
hugo server --environment development
```

生产构建前需要先运行媒体预处理脚本。否则缺少预生成文件时，主题可能回退到 Hugo 生成 WebP；原图尺寸过大或数量较多时，会明显增加构建内存。对于远大于站点最大展示尺寸的原图，建议先缩小再进入构建流程。

## 4. JS 文件按需加载

图片从数 MB 降下来以后，Lighthouse 中最明显的问题开始变成：

```text
Reduce unused JavaScript
```

目前文章页共引入了两个 JS 文件：

```
view-image.min.js 用于点击图片浮窗展示；

twikoo.min.js 用于展示twikoo评论；
```

在页面打开后就立即加载这两个文件，而评论部分在页面最下面，这个资源的加载时机不合理。

通过 article.js 文件引入 ViewImage 和 Twikoo loader，待用户接近评论区时才真正加载Twikoo评论。

```text
ViewImage
+
Twikoo loader
 ↓
article.js

Twikoo 本体
 ↓
用户接近评论区才加载
```

同时通过 Hugo 判断页面是否有插入图片，有的话才加载 ViewImage 代码，改为按需加载。

1. 下载 view-image.min.js 到 assets/js/vendor目录下，不再依赖 tokinx.github.io 服务访问。
2. 通过 Hugo Pipeline 构建文章页 JS文件引入。

文件目录：

```text
assets/js/
├── article.js
└── vendor/
    └── view-image.min.js
```

article.js 文件代码如下：

```
"use strict";


// ============================================================
// Hugo build-time configuration
// ============================================================

const TWIKOO_VERSION =
    {{ .Params.twikoo.version | jsonify }};

const TWIKOO_ENV_ID =
    {{ (.Params.twikoo.envId | default "") | jsonify }};

const TWIKOO_URL =
    `https://cdnjs.cloudflare.com/ajax/libs/twikoo/${TWIKOO_VERSION}/twikoo.min.js`;


// ============================================================
// ViewImage
// ============================================================

function initViewImage() {

    if (!window.ViewImage) {
        return;
    }

    const images =
        document.querySelectorAll(
            ".post-content img"
        );

    if (images.length === 0) {
        return;
    }

    window.ViewImage.init(
        ".post-content img"
    );
}


// ============================================================
// Twikoo state
// ============================================================

let twikooLoading = null;

let twikooInitialized = false;


// ============================================================
// Twikoo initialization
// ============================================================

function initTwikoo() {

    if (twikooInitialized) {
        return;
    }

    if (!window.twikoo) {
        return;
    }

    const container =
        document.querySelector(
            "#tcomment"
        );

    if (!container) {
        return;
    }

    twikooInitialized = true;

    try {

        const result =
            window.twikoo.init({
                envId:
                    TWIKOO_ENV_ID,
                el:
                "#tcomment",
                lang: 'zh-CN',
                region: 'ap-shanghai',
                path: window.TWIKOO_MAGIC_PATH||window.location.pathname,
            });

        if (
            result &&
            typeof result.catch ===
                "function"
        ) {

            result.catch(error => {

                twikooInitialized = false;

                console.error(
                    "Twikoo initialization failed:",
                    error
                );
            });
        }

    } catch (error) {

        twikooInitialized = false;

        console.error(
            "Twikoo initialization failed:",
            error
        );
    }
}


// ============================================================
// Dynamically load Twikoo
// ============================================================

function loadTwikoo() {

    if (window.twikoo) {

        initTwikoo();

        return Promise.resolve();
    }


    if (twikooLoading) {

        return twikooLoading;
    }


    twikooLoading =
        new Promise(
            (resolve, reject) => {

                const script =
                    document.createElement(
                        "script"
                    );

                script.src =
                    TWIKOO_URL;

                script.async =
                    true;

                script.crossOrigin =
                    "anonymous";


                script.onload =
                    () => {

                        initTwikoo();

                        resolve();
                    };


                script.onerror =
                    () => {

                        twikooLoading =
                            null;

                        reject(
                            new Error(
                                `Failed to load Twikoo: ${TWIKOO_URL}`
                            )
                        );
                    };


                document.head.appendChild(
                    script
                );
            }
        );


    return twikooLoading;
}


// ============================================================
// Lazy load Twikoo
// ============================================================

function initLazyTwikoo() {

    const container =
        document.querySelector(
            "#tcomment"
        );


    // 当前文章没有评论区域：
    // 完全不下载 Twikoo。

    if (!container) {
        return;
    }


    // 老浏览器 fallback

    if (
        !(
            "IntersectionObserver"
            in window
        )
    ) {

        loadTwikoo()
            .catch(console.error);

        return;
    }


    const observer =
        new IntersectionObserver(
            entries => {

                const shouldLoad =
                    entries.some(
                        entry =>
                            entry.isIntersecting
                    );


                if (!shouldLoad) {
                    return;
                }


                observer.disconnect();


                loadTwikoo()
                    .catch(error => {

                        console.error(
                            error
                        );
                    });
            },
            {
                // 用户距离评论区约 1000px
                // 时开始下载 Twikoo，
                // 避免滚动到评论区才等待。

                rootMargin:
                    "1000px 0px",
            }
        );


    observer.observe(
        container
    );
}


// ============================================================
// Article initialization
// ============================================================

function initArticle() {

    initViewImage();

    initLazyTwikoo();
}


// ============================================================
// DOM ready
// ============================================================

if (
    document.readyState ===
    "loading"
) {

    document.addEventListener(
        "DOMContentLoaded",
        initArticle,
        {
            once: true,
        }
    );

} else {

    initArticle();
}
```

把原有的 view-image.min.js 和 twikoo.min.js 加载代码全部去掉，在 layouts/partials/extend_footer.html 文件里增加下面代码：

```go-html-template
{{- if .IsPage -}}

    {{- $hasImages :=
        strings.Contains
            .Content
            "<img"
    -}}

    {{- $hasComments :=
        .Param "comments"
    -}}


    {{- if or $hasImages $hasComments -}}


        {{- $articleSource :=
            resources.Get
                "js/article.js"
        -}}


        {{- $article :=
            resources.ExecuteAsTemplate
                "js/article.generated.js"
                site
                $articleSource
        -}}


        {{- $bundle :=
            $article
        -}}


        {{- if $hasImages -}}

            {{- $viewImage :=
                resources.Get
                    "js/vendor/view-image.min.js"
            -}}


            {{- $bundle =
                slice
                    $viewImage
                    $article
                | resources.Concat
                    "js/article.js"
            -}}

        {{- else -}}

            {{- $bundle =
                slice $article
                | resources.Concat
                    "js/article.js"
            -}}

        {{- end -}}


        {{- $bundle =
            $bundle
            | minify
            | fingerprint "sha256"
        -}}


        <script
            src="{{ $bundle.RelPermalink }}"
            integrity="{{ $bundle.Data.Integrity }}"
            crossorigin="anonymous"
            defer>
        </script>


    {{- end -}}

{{- end -}}
```

![](lighthouse-result.png)

优化后的 Lighthouse 测试效果，目前自己体感快了一些，不知道是不是错觉。

博客优化永无止境，咱这次就先优化到这里。😁
