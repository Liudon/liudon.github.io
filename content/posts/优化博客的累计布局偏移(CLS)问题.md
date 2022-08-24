---
title: "优化博客的累计布局偏移(CLS)问题"
date: 2022-08-20T07:27:22+08:00
draft: false
slug: fix blog cls
tags: 
- 博客优化
- CLS
- PagerMod
---

此文已过期，优化方案参考[累计布局偏移修复方案改进 —— 自动生成图片宽高](https://liudon.com/posts/hugo-auto-generate-image-width-and-height/).

#### 问题表现

7月份将博客部署由`Github`迁移到`Cloudflare`后，开始关注博客的性能问题。

偶然看到苏卡卡大佬的[CLS优化文章](https://blog.skk.moe/post/fix-blog-cls/)，拿自己博客也测试了下，发现也存在同样的问题。

![Lighthouse测试报告](https://static.liudon.com/img/lighthouse_result.png)

根据苏卡卡大佬的文章，分析页面是由于文章封面的图片缺少宽高导致出现CLS问题。

为了解决这个问题，需要指定封面的宽高参数。

![cover.html code](https://static.liudon.com/img/cover-code.png)

根据`PagerMod`主题的`cover.html`文件代码，使用绝对地址的情况没有配置宽高参数。

#### 解决方案

1. 新增封面配置

    文章封面配置新增`width`和`height`属性。

    ```
    cover:
        image: "https://static.liudon.com/%E5%BE%AE%E4%BF%A1%E5%9B%BE%E7%89%87_20220725183817.jpg"
        width: 1620
        height: 1080
    ```

2. 自定义封面文件

    添加自己的`cover.html`文件，核心代码如下，完整代码参考[我的文件](https://github.com/Liudon/liudon.github.io/blob/code/layouts/partials/cover.html)。

    ```
        {{- else }}{{/* For absolute urls and external links, no img processing here */}}
            {{- if $addLink }}<a href="{{ (.Params.cover.image) | absURL }}" target="_blank"
                rel="noopener noreferrer">{{ end -}}
                <picture>
                <source type="image/webp" srcset="{{ (.Params.cover.image) | absURL }}/webp" {{- if (.Params.cover.width) }}width="{{ (.Params.cover.width) }}"{{ end -}} {{- if (.Params.cover.height) }}height="{{ (.Params.cover.height) }}"{{ end -}}>
                <img loading="lazy" alt="{{ $alt }}" src="{{ (.Params.cover.image) | absURL }}" {{- if (.Params.cover.width) }}width="{{ (.Params.cover.width) }}"{{ end -}} {{- if (.Params.cover.height) }}height="{{ (.Params.cover.height) }}"{{ end -}}>
                </picture>
        {{- end }}
    ```

    `img`标签新增`width`和`height`属性，读取封面配置的`width`和`height`属性值。

    图片我放到了腾讯云对象存储上，通过图片处理支持了`webp`格式图片。

    ![cos-img-process](https://static.liudon.com/img/cos-img-process.png)

3. 新增`css`配置

    新增如下配置，否则会导致图片变形。

    ```
    img {
        width:100%;
        height:auto;
    }

    figure {
        background-color: var(--code-bg);
    }
    ```

#### 再进一步

前面只解决了首页封面，文章页也会存在图片的情况，也会有类似的问题。

基于`markdown`语法的图片代码，是不支持宽高参数的。

还好`hugo`支持shortcode，其中就有`figure`语法，支持配置宽高参数。

![figure.html code](https://static.liudon.com/img/figure-code.png)

我们使用`figure`语法插入图片，指定图片宽高。

`figure`解析模板我也进行了改进，类似`cover.html`模板，也通过对象存储图片处理支持了webp响应式图片，核心代码如下，完整代码参考[我的文件](https://github.com/Liudon/liudon.github.io/blob/code/layouts/shortcodes/figure.html)。

```
    {{- if .Get "link" -}}
        <a href="{{ .Get "link" }}"{{ with .Get "target" }} target="{{ . }}"{{ end }}{{ with .Get "rel" }} rel="{{ . }}"{{ end }}>
    {{- end }}
    <picture>
        <source type="image/webp" srcset="{{ .Get "src" }}/webp" {{- with .Get "width" }} width="{{ . }}"{{ end -}}
        {{- with .Get "height" }} height="{{ . }}"{{ end -}}>
        <img loading="lazy" src="{{ .Get "src" }}{{- if eq (.Get "align") "center" }}#center{{- end }}"
         {{- if or (.Get "alt") (.Get "caption") }}
         alt="{{ with .Get "alt" }}{{ . }}{{ else }}{{ .Get "caption" | markdownify| plainify }}{{ end }}"
         {{- end -}}
         {{- with .Get "width" }} width="{{ . }}"{{ end -}}
         {{- with .Get "height" }} height="{{ . }}"{{ end -}}
        /> <!-- Closing img tag -->
    </picture>
    {{- if .Get "link" }}</a>{{ end -}}
```

使用方式：

> {##{< ##fig##ure## src="https://static.liudon.com/img/cover-code.png" alt="cover.html code" width="2020" height="1468" >}##}

*记得去掉#字符，这里为了防止解析为图片特意加上的。*

![gtmetrix-result](https://static.liudon.com/img/gtmetrix-result.png)

至此累计布局偏移(CLS)问题解决了，同时也支持了响应式图片。
