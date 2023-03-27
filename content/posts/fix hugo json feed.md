---
title: "修正Hugo的JSON Feed格式"
date: 2023-03-25T14:11:18+08:00
draft: false
tags:
    - hugo
---

#### 问题背景

前几天在[Planet](https://planetics.xyz/)里follow自己的[web3博客](https://liudon.eth)，遇到下面的错误。

![PlanetFeedError](https://static.liudon.com/img/202303251415675.png)

经过Livid大佬提醒，说是网站的JSON Feed不是标准格式导致的。

因为我的已经修正没法截图，这里以[dvel的博客](https://dvel.me/index.json)举例，格式类似如下。

```
[
  {
    "content": "用 ChatGPT 写一些小脚本真是太方便了。\nGPT-4 发布后试了试，还是蛮不错的，代码是 ChatGPT 生成的。\n几个来回就可以编写一个能正常使用的油猴脚本：\n（略，HTML 代码） 在 https://chdbits.co/bakatest.php 有如上内容。 我要为这个网页编写一个油猴脚本。 通过自动获取 ChatGPT 的 API 来解析此问题的答案，供用户参考。 将内容输出到 `#outer &gt; h1` 的下面，同时输出你提取到的问题内容和答案，以便我看看你是否提取正确。 获取错啦。 问题的获取路径是 `#outer &gt; form &gt; table &gt; tbody &gt; tr:nth-child(1) &gt; td` 选项的获取路径是 `#outer &gt; form &gt; table &gt; tbody &gt; tr:nth-child(2) &gt; td` 使用这个 API： ``` curl https://api.openai.com/v1/chat/completions \\ -H &#39;Content-Type: application/json&#39; \\ -H &#39;Authorization: Bearer YOUR_API_KEY&#39; \\ -d &#39;{ &#34;model&#34;: &#34;gpt-3.5-turbo&#34;, &#34;messages&#34;: [{&#34;role&#34;: &#34;user&#34;, &#34;content&#34;: &#34;Say this is a test!&#34;}], &#34;temperature&#34;: 0.7 }&#39; ``` 响应格式为： ``` { &#34;id&#34;:&#34;chatcmpl-abc123&#34;, &#34;object&#34;:&#34;chat.completion&#34;, &#34;created&#34;:1677858242, &#34;model&#34;:&#34;gpt-3.5-turbo-0301&#34;, &#34;usage&#34;:{ &#34;prompt_tokens&#34;:13, &#34;completion_tokens&#34;:7, &#34;total_tokens&#34;:20 }, &#34;choices&#34;:[ { &#34;message&#34;:{ &#34;role&#34;:&#34;assistant&#34;, &#34;content&#34;:&#34;\\n\\nThis is a test!&#34; }, &#34;finish_reason&#34;:&#34;stop&#34;, &#34;index&#34;:0 } ] } ``` 它没有最近的互联网数据，所以还是需要把 API 的使用方式发给它。\n然后它就帮我写好了，我不用复习 JavaScript，不用看油猴脚本的教程和文档，也不用查 @grant 等等标记是干嘛的。\n可以再继续要求它改进一些，比如换个输出位置，优化 prompt，自动选中正确回答，支持单选题和多选题等等。\n效果展示：\n安装： https://greasyfork.org/zh-CN/scripts/461944-chd-quiz-answer\n",
    "permalink": "https://dvel.me/posts/chd-quiz-answer/",
    "summary": "用 ChatGPT 写一些小脚本真是太方便了。\nGPT-4 发布后试了试，还是蛮不错的，代码是 ChatGPT 生成的。\n几个来回就可以编写一个能正常使用的油猴脚本：\n（略，HTML 代码） 在 https://chdbits.co/bakatest.php 有如上内容。 我要为这个网页编写一个油猴脚本。 通过自动获取 ChatGPT 的 API 来解析此问题的答案，供用户参考。 将内容输出到 `#outer &gt; h1` 的下面，同时输出你提取到的问题内容和答案，以便我看看你是否提取正确。 获取错啦。 问题的获取路径是 `#outer &gt; form &gt; table &gt; tbody &gt; tr:nth-child(1) &gt; td` 选项的获取路径是 `#outer &gt; form &gt; table &gt; tbody &gt; tr:nth-child(2) &gt; td` 使用这个 API： ``` curl https://api.openai.com/v1/chat/completions \\ -H &#39;Content-Type: application/json&#39; \\ -H &#39;Authorization: Bearer YOUR_API_KEY&#39; \\ -d &#39;{ &#34;model&#34;: &#34;gpt-3.5-turbo&#34;, &#34;messages&#34;: [{&#34;role&#34;: &#34;user&#34;, &#34;content&#34;: &#34;Say this is a test!",
    "title": "CHD 油猴脚本：每日签到自动答题"
  },
  ...
]
```

下面是一个`JSON Feed`的示例，详细规范见[jsonfeed.org](https://www.jsonfeed.org/)。

```
{
    "version": "https://jsonfeed.org/version/1.1",
    "title": "My Example Feed",
    "home_page_url": "https://example.org/",
    "feed_url": "https://example.org/feed.json",
    "items": [
        {
            "id": "2",
            "content_text": "This is a second item.",
            "url": "https://example.org/second-item"
        },
        {
            "id": "1",
            "content_html": "<p>Hello, world!</p>",
            "url": "https://example.org/initial-post"
        }
    ]
}
```

#### 修复方案

1. 添加自定义`jsonfeed`模版文件，路径为`layouts/_default/index.jsonfeed.json`。

文件内容如下：

```
{{- $pctx := . -}}
{{- if .IsHome -}}{{ $pctx = site }}{{- end -}}
{{- $pages := slice -}}
{{- if or $.IsHome $.IsSection -}}
{{- $pages = $pctx.RegularPages -}}
{{- else -}}
{{- $pages = $pctx.Pages -}}
{{- end -}}
{{- $limit := site.Config.Services.RSS.Limit -}}
{{- if ge $limit 1 -}}
{{- $pages = $pages | first $limit -}}
{{- end -}}
{{- $title := "" }}
{{- if eq .Title .Site.Title }}
{{- $title = .Site.Title }}
{{- else }}
{{- with .Title }}
{{- $title = print . " on "}}
{{- end }}
{{- $title = print $title .Site.Title }}
{{- end }}
{
    "version": "https://jsonfeed.org/version/1.1",
    "title": {{ $title | jsonify }},
    "home_page_url": {{ .Permalink | jsonify }},
    {{- with  .OutputFormats.Get "jsonfeed" }}
    "feed_url": {{ .Permalink | jsonify  }},
    {{- end }}
    {{- if (or .Site.Params.author .Site.Params.author_url) }}
    "authors": [{
      {{- if .Site.Params.author }}
        "name": {{ .Site.Params.author | jsonify }},
      {{- end }}
      {{- if .Site.Params.author_url }}
        "url": {{ .Site.Params.author_url | jsonify }}
      {{- end }}
    }],
    {{- end }}
    {{- if $pages }}
    "items": [
        {{- range $index, $element := $pages }}
        {{- with $element }}
        {{- if $index }},{{end}} {
            "title": {{ .Title | jsonify }},
            "id": {{ .Permalink | jsonify }},
            "url": {{ .Permalink | jsonify }},
            {{- if .Site.Params.showFullTextinJSONFeed }}
            "summary": {{ with .Description }}{{ . | jsonify }}{{ else }}{{ .Summary | jsonify }}{{ end -}},
            "content_html": {{ .Content | jsonify }},
            {{- else }}
            "content_text": {{ with .Description }}{{ . | jsonify }}{{ else }}{{ .Summary | jsonify }}{{ end -}},
            {{- end }}
            {{- if .Params.cover.image }}
            {{- $cover := (.Resources.ByType "image").GetMatch (printf "*%s*" (.Params.cover.image)) }}
            {{- if $cover }}
            "image": {{ (path.Join .RelPermalink $cover) | absURL | jsonify }},
            {{- end }}
            {{- end }}
            "date_published": {{ .Date.Format "2006-01-02T15:04:05Z07:00" | jsonify }},
            {{- $tags := slice -}}
            {{ with .Params.tags }}
            {{ range . }}
            {{ $tags = $tags | append (. | jsonify) }}
            {{end}}
            {{end}}
            "tags": [{{ delimit $tags ", " }}]
        }
        {{- end }}
        {{- end }}
    ]
    {{ end }}
}
```

2. 开启`JSON Feed`。

配置文件调整如下：

```
outputFormats:
  jsonfeed: # 添加jsonfeed输出格式
    mediaType: application/feed+json
    baseName: feed
    rel: alternate
    isPlainText: true

outputs:
    home:
        - HTML
        - RSS
        - jsonfeed # 开启jsonfeed

params:
    ...

    showFullTextinJSONFeed: true # jsonfeed开启全文输出
```

参考资料：[How to add JSON Feed support to Hugo](https://foosel.net/til/how-to-add-json-feed-support-to-hugo/)