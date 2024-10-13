---
title: "使用 ImageMagick 自动添加水印，保护图片版权"
date: 2024-10-12T23:32:31+08:00
draft: false
tags:
    - imagemagick
    - github
    - 版权
---

## 背景

细心的朋友可能会发现，我的博客图片都带上了水印。

经过[博客被恶意镜像](https://liudon.com/posts/blog-malicious-mirroring/)这个事情后，我一直在思考如何防止内容被恶意盗用，尤其是博客里的一些图片。

在[当Hugo遇上AVIF，优化图片加载](https://liudon.com/posts/use-avif-to-optimize-images-on-hugo/)这篇文章里，使用了ImageMagick工具做了图片压缩。

当时文章最后说留了个坑，其实就是今天的这篇内容，利用ImageMagick自动给图片添加水印。

## 实现

思路其实和之前图片压缩一样，还是在Github Action里使用ImageMagick工具进行添加水印操作，不依赖第三方云服务。

[workflow代码](https://github.com/Liudon/liudon.github.io/blob/code/.github/workflows/main.yml)：

```
- name: Compress Image
run: |
    # 安装依赖
    sudo apt-get update
    sudo apt-get install -y build-essential libx11-dev libxext-dev zlib1g-dev \
        libpng-dev libjpeg-dev libfreetype6-dev libxml2-dev liblcms2-dev \
        libopenexr-dev libtiff-dev libraw-dev libheif-dev libde265-dev \
        libfftw3-dev libglib2.0-dev libwebp-dev

    # 编译ImageMagick
    wget https://download.imagemagick.org/ImageMagick/download/ImageMagick.tar.gz
    tar xvzf ImageMagick.tar.gz
    cd ImageMagick-7.*
    ./configure
    make
    sudo make install
    sudo ldconfig /usr/local/lib

    magick --version

    cd ../

    # 将原图转换大小，同时添加文本水印
    find ./content/posts/ -type f \( -name "*.jpg" -o -name "*.png" -o -name "*.jpeg" \) -exec magick {} -pointsize 48 -fill "#909090" -font ./static/ArchitectsDaughter-Regular.ttf -gravity south -annotate +0+20 "@liudon\nhttps://liudon.com" -resize 1080x\> {} \;

    # 将处理后的原图生成webp格式文件
    find ./content/posts/ -type f \( -name "*.jpg" -o -name "*.png" -o -name "*.jpeg" \) -exec magick {} -quality 75 -define webp:image-hint=photo {}_1080x.webp \;

    # 将处理后的原图生成avif格式文件
    find ./content/posts/ -type f \( -name "*.jpg" -o -name "*.png" -o -name "*.jpeg" \) -exec magick {} {}_1080x.avif \;
```

1. 先将原图进行大小转换，同时添加文本水印：

    ```
    -fill #909090 代表水印颜色
    -pointsize 48 代表水印文字大小
    -font ./static/ArchitectsDaughter-Regular.ttf 代表水印字体，我使用了ArchitectsDaughter字体，提前下载到了git仓库
    @liudon\nhttps://liudon.com 代表文本水印内容，\n表示换行
    -gravity south 水印位置，九宫格位置
    -annotate +0+20 水印偏移
    ```

    [水印字体文件下载](https://fonts.google.com/specimen/Architects+Daughter)

2. 将处理后的原图生成webp和avif格式文件

*注意，通过`sudo apt-get install -y imagemagick libheif-dev`安装的ImageMagick版本是6.x，转换过程会有些问题，所以这里改为了通过源码编译最新7.x版本，编译的时间略久一些。*

```
Version: ImageMagick 7.1.1-39 Q16-HDRI x86_64 22428 https://imagemagick.org
Copyright: (C) 1999 ImageMagick Studio LLC
License: https://imagemagick.org/script/license.php
Features: Cipher DPC HDRI OpenMP(4.5) 
Delegates (built-in): bzlib djvu fontconfig freetype heic jbig jng jp2 jpeg lcms lqr lzma openexr png raw tiff webp x xml zlib zstd
Compiler: gcc (11.4)
```

好了，这样后续提交Github后，Workflow就会自动利用ImageMagick帮我们处理图片了。