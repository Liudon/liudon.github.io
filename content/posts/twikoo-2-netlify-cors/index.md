---
title: "Twikoo 2.x 升级踩坑：Netlify CORS 报错与解决方案"
date: 2026-09-22T00:48:00+08:00
draft: false
tags:
  - Twikoo
  - Netlify
  - CORS
  - 博客部署
keywords:
  - Twikoo 2.0
  - Twikoo Netlify
  - Twikoo CORS
  - Access-Control-Allow-Origin
  - Netlify OPTIONS
description: "记录 Twikoo 2.x 升级后 Netlify 评论服务出现 CORS 报错的问题、原因以及临时和长期解决方案。"
---

## 前言

刚更新完上一篇[《我给博客做了一个时光机》](/posts/hugo-ipfs-time-machine/)，顺手打开文章看看效果，结果发现评论区挂了。

浏览器控制台报错：

```text
Access to XMLHttpRequest at 'https://comment.example.com/'
from origin 'https://blog.example.com' has been blocked by CORS policy:

Response to preflight request doesn't pass access control check:
No 'Access-Control-Allow-Origin' header is present on the requested resource.
```

评论服务一直使用 Twikoo + Netlify，之前也运行得好好的，最近并没有修改过 CORS 配置。

排查后发现，问题刚好出现在 **Twikoo 从 1.x 自动升级到 2.x** 之后。

最后实际碰到了两个问题：

```text
Twikoo 1.x
   ↓
升级 Twikoo 2.x
   ↓
Node 18 不再支持
   ↓
升级 Node 22
   ↓
服务恢复运行
   ↓
OPTIONS 预检仍然没有 CORS Header
   ↓
Netlify Adapter 存在 Bug
```

如果你也是使用 Netlify 部署 Twikoo，升级 2.x 后评论突然出现 CORS 错误，可以重点看下面两个地方。

## 先升级 Node.js

Netlify 原来使用的是：

```text
Node v18.20.8
```

升级 Twikoo 2.x 后，构建日志出现大量：

```text
npm warn EBADENGINE
required: { node: '>=20.19.0' }
current: { node: 'v18.20.8' }
```

甚至直接访问 Twikoo 后端时返回：

```json
{"code":1000,"message":"crypto is not defined"}
```

Twikoo 2.x 已经不再适配 Node 18。

所以首先把 Netlify 的 Node.js 升到 22：

```text
NODE_VERSION=22
```

或者项目根目录增加：

```text
.nvmrc
```

内容：

```text
22
```

然后重新部署。

如果访问 Twikoo 后端还有类似：

```text
crypto is not defined
```

先不要折腾 CORS，把 Node 版本解决掉。

## Node 22 后还是 CORS 报错

升级 Node 22 后，Twikoo 后端可以正常运行，但评论区依然报：

```text
No 'Access-Control-Allow-Origin' header
```

这时可以直接模拟浏览器的 OPTIONS 请求。

下面的 `https://blog.example.com` 需要替换成你自己的博客域名：

```bash
BLOG_ORIGIN='https://blog.example.com' # 替换为你自己的博客域名

curl -i -X OPTIONS 'https://comment.example.com/' \
  -H "Origin: ${BLOG_ORIGIN}" \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: content-type'
```

`https://comment.example.com/` 同样替换成自己的 Twikoo 服务地址。

返回：

```text
HTTP/2 204
```

看起来没毛病。

但是 Response Header 里没有：

```text
Access-Control-Allow-Origin
Access-Control-Allow-Methods
Access-Control-Allow-Headers
```

也就是说：

```text
OPTIONS
   ↓
204
   ↓
缺少 CORS Header
   ↓
浏览器阻止后续 POST
```

## 根因

继续看 Twikoo 2.x 的 Netlify Adapter：

```text
packages/server-netlify/src/main.ts
```

里面有这样一段：

```ts
export function fromTkResponse(tkRes: TkResponse): NetlifyResult {
  if (tkRes.status === 204) {
    return { statusCode: 204, headers: {}, body: "" };
  }

  return {
    statusCode: tkRes.status,
    headers: { ...tkRes.headers, "Content-Type": "application/json" },
    body: JSON.stringify(tkRes.body),
  };
}
```

Twikoo 公共层其实已经生成了 CORS Header。

但是 OPTIONS 返回 `204` 时：

```ts
headers: {}
```

又把这些 Header 全部丢掉了。

实际流程变成：

```text
Browser
   ↓
OPTIONS
   ↓
Twikoo Pipeline
   ↓
生成 CORS Header
   ↓
Netlify Adapter
   ↓
204 分支
   ↓
headers: {}
   ↓
CORS Header 丢失
```

所以这并不是自己的 CORS 配置错误，而是 Netlify Adapter 在处理 `204` 时存在问题。

## 临时解决方案

如果现在就需要恢复评论，可以先修改自己部署项目里的：

```text
netlify/functions/twikoo.js
```

原来可能只是：

```js
exports.handler = require('twikoo-netlify').handler
```

可以暂时在外面包一层，自己处理 OPTIONS：

```js
const { handler } = require('twikoo-netlify')

const ALLOWED_ORIGINS = new Set([
  'https://blog.example.com', // 替换为你自己的博客域名
])

function corsHeaders(origin) {
  if (!origin || !ALLOWED_ORIGINS.has(origin)) {
    return {}
  }

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'POST',
    'Access-Control-Allow-Headers':
      'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  }
}

exports.handler = async function (event, context) {
  const origin =
    event.headers?.origin ||
    event.headers?.Origin ||
    ''

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: corsHeaders(origin),
      body: ''
    }
  }

  const result = await handler(event, context)

  return {
    ...result,
    headers: {
      ...(result.headers || {}),
      ...corsHeaders(origin)
    }
  }
}
```

重新部署后再测试：

```bash
BLOG_ORIGIN='https://blog.example.com' # 替换为你自己的博客域名

curl -i -X OPTIONS 'https://comment.example.com/' \
  -H "Origin: ${BLOG_ORIGIN}" \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: content-type'
```

正常应该能看到：

```text
HTTP/2 204

Access-Control-Allow-Origin: https://blog.example.com
Access-Control-Allow-Credentials: true
Access-Control-Allow-Methods: POST
```

这个方案适合**临时救急**。

等官方版本修复以后，这层 Wrapper 就可以删掉。

## 长期解决方案

真正应该修的是 Twikoo 自己的 Netlify Adapter。

改动其实只有一行：

```diff
- return { statusCode: 204, headers: {}, body: "" };
+ return { statusCode: 204, headers: { ...tkRes.headers }, body: "" };
```

这样 OPTIONS 返回 `204` 时，可以继续保留公共 Pipeline 已经生成好的 CORS Header。

相关修复已经提交 PR：

[twikoojs/twikoo#1165](https://github.com/twikoojs/twikoo/pull/1165)

长期方案就是等待 PR 合并，官方重新发布版本后升级 `twikoo-netlify`，再删除前面的临时 Wrapper。

## 总结

如果升级 Twikoo 2.x 后，Netlify 部署的评论突然挂掉，可以先看两个地方：

```text
Node 版本
   ↓
至少 20.19，建议直接 Node 22

OPTIONS 预检
   ↓
204 是否带 Access-Control-Allow-Origin
```

Node 版本不对，先升级 Node。

Node 已经正常，但 OPTIONS 的 `204` 没有 CORS Header，可以先用上面的 Wrapper 临时解决，然后等待官方修复版本再升级。

这次让我比较意外的，其实不是出现 Bug。

大版本重构出现 Bug 很正常。

问题在于 Twikoo 2.0 不只是普通版本更新：

```text
Node 运行时要求发生变化
+
后端大规模重构
+
现有 Netlify 部署存在兼容问题
```

但对于原来使用 `latest` 或自动更新的用户来说，很可能在完全没有主动升级的情况下，就直接从 1.x 跳到了 2.x。

我的情况就是：

```text
刚写完一篇文章
↓
打开博客看看
↓
评论突然挂了
```

这种涉及运行时最低版本变化的大版本升级，我觉得官方这次处理得有些草率。

至少应该在升级前做更明显的周知，或者给现有部署用户留出一个更明确的迁移窗口，而不是让大量使用 `latest` 的老部署直接跟着升级。

否则用户最后看到的只有一句：

```text
No 'Access-Control-Allow-Origin' header
```

然后从 CORS 一路查到 Netlify、Node.js，最后再翻到 Adapter 源码。

希望后续版本升级能稳一点。
